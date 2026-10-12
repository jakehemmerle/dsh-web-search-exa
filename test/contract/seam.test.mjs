// Contract suite: the plugin against the real pinned @deepseek-ai/dsh-web
// seam and Cordis runtime (P-01, P-04, P-15, P-23). A DSH bump that changes
// any of these fails here first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as plugin from '../../lib/index.js';
import { emulateHostArgv, hostModules, hostPackageDir, dshVersion } from '../support/host.mjs';
import { startMockExa, EXA_OK } from '../support/mock-exa.mjs';

emulateHostArgv();
const PINNED = '0.2.1-alpha.2';
const { Context, WebRuntime, WebError, HarnessError } = await hostModules();

async function boot(webConfig, pluginConfig) {
  const root = new Context();
  await root.plugin(WebRuntime, webConfig);
  const fiber = root.plugin(plugin, pluginConfig);
  await fiber;
  return { root, fiber };
}

test('P-23 the pinned DSH and dsh-web seam are the versions under test', () => {
  assert.equal(dshVersion(), PINNED);
  const web = JSON.parse(readFileSync(join(hostPackageDir('@deepseek-ai/dsh-web'), 'package.json'), 'utf8'));
  assert.equal(web.version, PINNED);
  assert.equal(typeof WebRuntime.prototype.registerSearchProvider, 'function');
  assert.equal(typeof WebRuntime.prototype.search, 'function');
  assert.ok(new WebError('m', 'C') instanceof HarnessError, 'WebError extends HarnessError');
  assert.equal(new WebError('m', 'C').code, 'C');
});

test('P-23 dsh-tools keeps structured {name, code} only for HarnessError tool failures', () => {
  const src = readFileSync(join(hostPackageDir('@deepseek-ai/dsh-tools'), 'lib/index.js'), 'utf8');
  assert.match(src, /error instanceof HarnessError \? \{\s*name: error\.name,\s*code: error\.code/);
});

test('P-01 the plugin declares inject [web] and registers search provider "exa"', async () => {
  assert.deepEqual(plugin.inject, ['web']);
  assert.equal(plugin.name, 'web-search-exa');
  const exa = await startMockExa();
  const { root, fiber } = await boot({ searchProvider: 'exa' }, { apiKey: 'contract-key-1', baseURL: exa.baseURL });
  try {
    assert.ok(root.web.searchProviders.has('exa'));
    const result = await root.web.search({ query: 'cordis' });
    assert.equal(exa.searches().length, 1);
    assert.deepEqual(result.sources.map((s) => s.url), EXA_OK('cordis').json.results.map((r) => r.url));
  } finally { await fiber.dispose(); await exa.close(); }
});

test('P-01 with no pinned id the seam auto-selects exa as the only provider', async () => {
  const exa = await startMockExa();
  const { root, fiber } = await boot({}, { apiKey: 'contract-key-1', baseURL: exa.baseURL });
  try {
    const result = await root.web.search({ query: 'solo' });
    assert.equal(result.sources.length, 3);
  } finally { await fiber.dispose(); await exa.close(); }
});

test('P-04 the seam caps sources to maxResults and flags truncated', async () => {
  const exa = await startMockExa({ scenario: (req) => EXA_OK(req.json.query, 7) });
  const { root, fiber } = await boot({ searchProvider: 'exa' }, { apiKey: 'contract-key-1', baseURL: exa.baseURL });
  try {
    for (const max of [1, 3, 7, 9]) {
      const result = await root.web.search({ query: 'cap', maxResults: max });
      assert.equal(result.sources.length, Math.min(max, 7));
      assert.equal(result.truncated, max < 7);
      assert.equal(exa.searches().at(-1).json.numResults, max, 'numResults forwarded to Exa');
    }
  } finally { await fiber.dispose(); await exa.close(); }
});

test('P-15 disposing the plugin unregisters exa; the seam reports it missing', async () => {
  const exa = await startMockExa();
  const { root, fiber } = await boot({ searchProvider: 'exa' }, { apiKey: 'contract-key-1', baseURL: exa.baseURL });
  await fiber.dispose();
  try {
    await assert.rejects(root.web.search({ query: 'gone' }), (e) => e instanceof WebError && e.code === 'WEB_PROVIDER_CONFIGURED_MISSING');
    assert.equal(exa.searches().length, 0);
  } finally { await exa.close(); }
});
