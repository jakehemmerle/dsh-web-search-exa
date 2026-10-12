// P-14: configuration is read per search (live config objects with .get()).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerProvider, withFetch, jsonResponse } from '../support/provider.mjs';
import { emulateHostArgv } from '../support/host.mjs';

emulateHostArgv();

const live = (value) => ({ value, get() { return this.value; } });

test('P-14 config changes apply on the next search without re-registration', async () => {
  const baseURL = live('http://one.test');
  const apiKey = live('key-one-123');
  const type = live('auto');
  const provider = await registerProvider({ baseURL, apiKey, type });
  const { calls } = await withFetch(() => jsonResponse({ results: [] }), async () => {
    await provider.search({ query: 'a' });
    baseURL.value = 'http://two.test';
    apiKey.value = 'key-two-456';
    type.value = 'neural';
    await provider.search({ query: 'b' });
  });
  assert.equal(calls[0].url, 'http://one.test/search');
  assert.equal(calls[0].init.headers['x-api-key'], 'key-one-123');
  assert.equal(calls[1].url, 'http://two.test/search');
  assert.equal(calls[1].init.headers['x-api-key'], 'key-two-456');
  assert.equal(calls[1].body.type, 'neural');
});
