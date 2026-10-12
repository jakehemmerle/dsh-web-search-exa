// Builds the plugin's provider through its public apply() with a fake ctx.web
// that captures the registration, and a fetch stub that records requests.
import { apply } from '../../lib/index.js';

export async function registerProvider(config = {}, { credentials } = {}) {
  let provider;
  const ctx = {
    web: { registerSearchProvider(p) { provider = p; return () => {}; } },
    get(name) { return name === 'credentials' ? credentials : undefined; },
    effect() {},
    on() { return () => {}; },
  };
  await apply(ctx, config);
  if (!provider) throw new Error('apply() registered no search provider');
  return provider;
}

/** Replace globalThis.fetch for the duration of fn; responder(url, init) -> Response. */
export async function withFetch(responder, fn) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined });
    return responder(String(url), init, calls.length - 1);
  };
  try { return { result: await fn(calls), calls }; } finally { globalThis.fetch = original; }
}

export const jsonResponse = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
