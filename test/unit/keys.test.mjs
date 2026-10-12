// P-05 / P-06: API key sources and key-file formats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerProvider, withFetch, jsonResponse } from '../support/provider.mjs';
import { emulateHostArgv } from '../support/host.mjs';

emulateHostArgv();
delete process.env.EXA_API_KEY;
delete process.env.EXA_TEST_KEY;

const dir = mkdtempSync(join(tmpdir(), 'exa-keys-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const keyFile = (content) => { const p = join(dir, `k${n += 1}`); writeFileSync(p, content); return p; };

async function sentKey(config, options) {
  const provider = await registerProvider({ baseURL: 'http://exa.test', apiKeyEnv: 'EXA_TEST_KEY', ...config }, options);
  const { calls } = await withFetch(() => jsonResponse({ results: [] }), () => provider.search({ query: 'q' }).catch((e) => e));
  return calls.length ? calls[0].init.headers['x-api-key'] : undefined;
}

test('P-05 a literal apiKey wins over every other source', async () => {
  process.env.EXA_TEST_KEY = 'from-env';
  try {
    const credentials = { resolve: async () => ({ value: 'from-credentials' }) };
    assert.equal(await sentKey({ apiKey: 'literal-key', apiKeyFile: keyFile('from-file\n') }, { credentials }), 'literal-key');
  } finally { delete process.env.EXA_TEST_KEY; }
});

test('P-05 the environment variable named by apiKeyEnv supplies the key', async () => {
  process.env.EXA_TEST_KEY = 'env-key-1';
  try { assert.equal(await sentKey({}), 'env-key-1'); } finally { delete process.env.EXA_TEST_KEY; }
});

test('P-05 the credentials service supplies the key for apiKeyEnv', async () => {
  const seen = [];
  const credentials = { resolve: async (ref) => { seen.push(String(ref)); return { value: 'cred-key' }; } };
  assert.equal(await sentKey({}, { credentials }), 'cred-key');
  assert.deepEqual(seen, ['EXA_TEST_KEY']);
});

test('P-06 a raw key file is the trimmed file content', async () => {
  assert.equal(await sentKey({ apiKeyFile: keyFile('  raw-key-123  \n') }), 'raw-key-123');
});

test('P-06 a dotenv key file yields the last NAME=value line for apiKeyEnv', async () => {
  const file = keyFile('OTHER=nope\nEXA_TEST_KEY=first\nEXA_TEST_KEY=second\n');
  assert.equal(await sentKey({ apiKeyFile: file }), 'second');
});

test('P-06 a dotenv file without apiKeyEnv sends no key and makes no request', async () => {
  assert.equal(await sentKey({ apiKeyFile: keyFile('OTHER=value\n') }), undefined);
});

test('P-06 a missing key file sends no request', async () => {
  assert.equal(await sentKey({ apiKeyFile: join(dir, 'missing') }), undefined);
});
