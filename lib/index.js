// Exa search provider for the DeepSeek Harness web seam (ctx.web).
// Dependency-free so the Loader can import it from a Nix store path.

import { readFile } from 'node:fs/promises';

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

function webError(message, code, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.name = 'WebError';
  error.code = code;
  return error;
}

function snippetOf(result) {
  const parts = Array.isArray(result.highlights) ? result.highlights : [];
  const text = parts.map((part) => String(part).trim()).filter(Boolean).join(' … ');
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
    return true;
  }

  async search(request, signal) {
    const options = this.options();
    const apiKey = await options.resolveApiKey();
    if (!apiKey) {
      throw webError(`Exa search needs an API key in $${options.apiKeyEnv}${options.apiKeyFile ? ` or ${options.apiKeyFile}` : ''}`, 'WEB_PROVIDER_UNAVAILABLE');
    }
    const body = {
      query: request.query,
      type: options.type,
      contents: { highlights: { maxCharacters: options.highlightChars } },
    };
    if (request.maxResults !== undefined) body.numResults = request.maxResults;

    const timeout = AbortSignal.timeout(options.timeoutMs);
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
      if (timeout.aborted) throw webError(`Exa search timed out after ${options.timeoutMs}ms`, 'WEB_PROVIDER_FAILED', error);
      throw webError('Exa search request failed', 'WEB_PROVIDER_FAILED', error);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 500);
      throw webError(`Exa search returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`, 'WEB_PROVIDER_FAILED');
    }
    const data = await response.json();
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

// A dotenv file yields its last `NAME=value` line; any other file is the raw key.
async function keyFromFile(path, name) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
  const lines = text.split(/\r?\n/);
  if (lines.some((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))) {
    const prefix = `${name}=`;
    const match = lines.filter((line) => line.startsWith(prefix)).pop();
    return match ? match.slice(prefix.length).trim() || undefined : undefined;
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
        if (process.env[apiKeyEnv]) return process.env[apiKeyEnv];
        // Read per search, so a process started before the key was exported
        // (or reloaded in place) still finds it.
        return apiKeyFile ? await keyFromFile(apiKeyFile, apiKeyEnv) : undefined;
      },
    };
  }));
}
