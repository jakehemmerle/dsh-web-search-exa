// P-02: the outgoing Exa request is exactly the documented shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fc, fcOptions } from '../support/fc.mjs';
import { registerProvider, withFetch, jsonResponse } from '../support/provider.mjs';
import { emulateHostArgv } from '../support/host.mjs';

emulateHostArgv();

const keyArb = fc.stringMatching(/^[A-Za-z0-9_-]{8,48}$/);
const configArb = fc.record({
  apiKey: keyArb,
  base: fc.constantFrom('http://exa.test', 'https://api.exa.ai', 'http://127.0.0.1:9/v1'),
  slashes: fc.integer({ min: 0, max: 3 }),
  type: fc.option(fc.constantFrom('auto', 'neural', 'keyword', 'fast'), { nil: undefined }),
  highlightChars: fc.option(fc.integer({ min: 1, max: 5000 }), { nil: undefined }),
});
const requestArb = fc.record({
  query: fc.string({ unit: 'grapheme', maxLength: 200 }),
  maxResults: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
}, { requiredKeys: ['query'] });

test('P-02 request shape: POST <baseURL>/search with x-api-key and the documented body', async () => {
  await fc.assert(fc.asyncProperty(configArb, requestArb, async (c, request) => {
    const config = { apiKey: c.apiKey, baseURL: c.base + '/'.repeat(c.slashes) };
    if (c.type !== undefined) config.type = c.type;
    if (c.highlightChars !== undefined) config.highlightChars = c.highlightChars;
    const provider = await registerProvider(config);
    const { calls } = await withFetch(() => jsonResponse({ results: [] }), () => provider.search(request));
    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call.url, c.base + '/search');
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers['x-api-key'], c.apiKey);
    assert.equal(call.init.headers['content-type'], 'application/json');
    const expected = {
      query: request.query,
      type: c.type ?? 'auto',
      contents: { highlights: { maxCharacters: c.highlightChars ?? 600 } },
    };
    if (request.maxResults !== undefined) expected.numResults = request.maxResults;
    assert.deepEqual(call.body, expected);
  }), fcOptions('P-02 request shape'));
});
