// Exa search provider for the DeepSeek Harness web seam (ctx.web).
// Dependency-free so the Loader can import it from a Nix store path.

import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// The host WebError lives in @deepseek-ai/dsh-web, a peer the Loader resolves
// from the dsh package that imported us. dsh runs <dsh>/lib/bin.js, so the
// plugin resolves host modules from process.argv[1] (the dsh-speed pattern).
let hostWebError;
function hostErrorClass() {
  if (hostWebError === undefined) {
    hostWebError = createRequire(process.argv[1] ?? import.meta.url)('@deepseek-ai/dsh-web').WebError;
  }
  return hostWebError;
}

export const name = 'web-search-exa';
export const inject = ['web'];

export const EXA_PROVIDER_ID = 'exa';
const DEFAULTS = {
  apiKeyEnv: 'EXA_API_KEY',
  baseURL: 'https://api.exa.ai',
  type: 'auto',
  highlightChars: 600,
  timeoutMs: 30000,
};

function webError(message, code, cause, status) {
  // Host class, so errorInfo() keeps {name, code} in the tool result.
  const error = new (hostErrorClass())(message, code, cause === undefined ? undefined : { cause });
  if (status !== undefined) error.status = status;
  return error;
}

function snippetOf(result) {
  const parts = Array.isArray(result.highlights) ? result.highlights : [];
  const text = parts.filter((part) => typeof part === 'string').map((part) => part.trim()).filter(Boolean).join(' … ');
  if (text) return text;
  if (typeof result.summary === 'string' && result.summary.trim()) return result.summary.trim();
  if (typeof result.text === 'string' && result.text.trim()) return result.text.trim().slice(0, 600);
  return undefined;
}

export class ExaSearchProvider {
  id = EXA_PROVIDER_ID;

  constructor(options) {
    this.options = options;
  }

  available() {
    // Mirror resolveApiKey's sources, synchronously: the seam consults this at
    // execution time to select or reject the provider.
    const options = this.options();
    if (options.apiKey) return true;
    if (process.env[options.apiKeyEnv]) return true;
    if (options.hasCredentials) return true;
    if (options.apiKeyFile) {
      try { readFileSync(options.apiKeyFile, 'utf8'); return true; } catch { return false; }
    }
    return false;
  }

  async search(request, signal) {
    const options = this.options();
    const apiKey = await options.resolveApiKey();
    if (!apiKey) {
      throw webError(`Exa search needs an API key in ${options.apiKeyEnv}${options.apiKeyFile ? ` or ${options.apiKeyFile}` : ''}`, 'WEB_PROVIDER_CREDENTIAL_MISSING');
    }
    const body = {
      query: request.query,
      type: options.type,
      contents: { highlights: { maxCharacters: options.highlightChars } },
    };
    if (request.maxResults !== undefined) body.numResults = request.maxResults;

    const timeoutMs = Number(options.timeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw webError(`Exa search config timeoutMs must be a positive number of milliseconds (got ${JSON.stringify(options.timeoutMs ?? null)})`, 'WEB_PROVIDER_ERROR');
    }
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await fetch(`${options.baseURL.replace(/\/+$/, '')}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (error) {
      if (signal?.aborted) throw webError('Exa search aborted', 'WEB_ABORTED', signal.reason);
      if (timeout.aborted) throw webError(`Exa search timed out after ${options.timeoutMs}ms`, 'WEB_PROVIDER_ERROR', error);
      throw webError('Exa search request failed', 'WEB_PROVIDER_ERROR', error);
    }
    if (!response.ok) {
      // Never echo the upstream body (it may contain the key or arbitrary
      // text); the status rides on the error and in the message.
      await response.text().catch(() => '');
      throw webError(`Exa search returned HTTP ${response.status}`, 'WEB_PROVIDER_ERROR', undefined, response.status);
    }
    let data;
    try {
      data = await response.json();
    } catch (error) {
      if (signal?.aborted) throw webError('Exa search aborted', 'WEB_ABORTED', signal.reason);
      if (timeout.aborted) throw webError(`Exa search timed out after ${options.timeoutMs}ms`, 'WEB_PROVIDER_ERROR', error);
      throw webError('Exa search returned an unparseable 200 response body', 'WEB_PROVIDER_ERROR', error);
    }
    const results = Array.isArray(data?.results) ? data.results : [];
    const sources = results
      .filter((result) => typeof result?.url === 'string' && result.url)
      .map((result) => {
        const source = { url: result.url };
        if (typeof result.title === 'string' && result.title) source.title = result.title;
        const snippet = snippetOf(result);
        if (snippet) source.snippet = snippet;
        if (typeof result.publishedDate === 'string' && result.publishedDate) source.publishedAt = result.publishedDate;
        return source;
      });
    return { sources, truncated: false };
  }
}

// A dotenv file yields its last `NAME=value` line for `name` (optional
// `export \` prefix, single/double quotes stripped); any other file is the
// raw key.
const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}
async function keyFromFile(path, name) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
  const entries = text.split(/\r?\n/).map((line) => line.match(ENV_LINE)).filter(Boolean);
  if (entries.length > 0) {
    const match = entries.filter((entry) => entry[1] === name).pop();
    return match ? unquote(match[2]) || undefined : undefined;
  }
  return text.trim() || undefined;
}

function read(value) {
  return value && typeof value.get === 'function' ? value.get() : value;
}

export function apply(ctx, config = {}) {
  ctx.web.registerSearchProvider(new ExaSearchProvider(() => {
    const apiKeyEnv = read(config.apiKeyEnv) ?? DEFAULTS.apiKeyEnv;
    const literal = read(config.apiKey);
    const apiKeyFile = read(config.apiKeyFile);
    return {
      apiKeyEnv,
      apiKeyFile,
      apiKey: literal,
      hasCredentials: ctx.get('credentials') !== undefined,
      baseURL: read(config.baseURL) ?? DEFAULTS.baseURL,
      type: read(config.type) ?? DEFAULTS.type,
      highlightChars: read(config.highlightChars) ?? DEFAULTS.highlightChars,
      timeoutMs: read(config.timeoutMs) ?? DEFAULTS.timeoutMs,
      resolveApiKey: async () => {
        if (literal) return literal;
        const credentials = ctx.get('credentials');
        if (credentials !== undefined) {
          const resolved = await credentials.resolve(apiKeyEnv);
          if (resolved?.value) return resolved.value;
        }
        // Read the file per search, before the (stale) launch-time env: a
        // rotated key file applies without restarting the process.
        if (apiKeyFile) {
          const fromFile = await keyFromFile(apiKeyFile, apiKeyEnv);
          if (fromFile) return fromFile;
        }
        if (process.env[apiKeyEnv]) return process.env[apiKeyEnv];
        return undefined;
      },
    };
  }));
}