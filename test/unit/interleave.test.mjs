// P-21: interleaved searches each get their own results — no cross-talk of
// queries, keys or mapped sources between two in-flight requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fc, fcOptions } from '../support/fc.mjs';
import { registerProvider } from '../support/provider.mjs';
import { startMockExa, EXA_OK } from '../support/mock-exa.mjs';
import { emulateHostArgv } from '../support/host.mjs';
import { expectedSources } from '../support/oracle.mjs';

emulateHostArgv();

const queryArb = fc.string({ unit: 'grapheme', minLength: 2, maxLength: 30 })
  .filter((s) => /^[\w ./-]+$/.test(s) && s.trim().length >= 2);

test('P-21 two interleaved searches each complete with their own results', async () => {
  const provider = await registerProvider({ apiKey: 'k-123456789', baseURL: 'PLACEHOLDER' });
  await fc.assert(fc.asyncProperty(queryArb, queryArb, async (qa, qb) => {
    if (qa === qb) return;
    const exa = await startMockExa({ scenario: (req) => {
      const q = req.json?.query;
      if (q === qa) return EXA_OK(qa, 1);
      if (q === qb) return EXA_OK(qb, 3);
      return { status: 500, json: { error: 'unexpected query' } };
    } });
    try {
      provider.options = () => ({ apiKeyEnv: 'EXA_API_KEY', apiKeyFile: undefined, apiKey: 'k-123456789', hasCredentials: false, baseURL: exa.baseURL, type: 'auto', highlightChars: 600, timeoutMs: 5000, resolveApiKey: async () => 'k-123456789' });
      const [ra, rb] = await Promise.all([
        provider.search({ query: qa }).then((r) => r, (e) => e),
        provider.search({ query: qb }).then((r) => r, (e) => e),
      ]);
      assert.equal(exa.searches().length, 2, 'both searches reached Exa');
      const queries = exa.searches().map((s) => s.json.query).sort();
      assert.deepEqual(queries, [qa, qb].sort(), 'each request carried its own query');
      for (const s of exa.searches()) assert.equal(s.headers['x-api-key'], 'k-123456789');
      const byQuery = new Map(exa.searches().map((s) => [s.json.query, s]));
      assert.deepEqual(ra.sources, expectedSources(byQuery.get(qa).plan.json), 'result A matches its own response');
      assert.deepEqual(rb.sources, expectedSources(byQuery.get(qb).plan.json), 'result B matches its own response');
      assert.equal(ra.sources.length, 1);
      assert.equal(rb.sources.length, 3);
    } finally { await exa.close(); }
  }), fcOptions('P-21 interleaved searches', { numRuns: Number(process.env.NUM_RUNS ?? 300) }));
});