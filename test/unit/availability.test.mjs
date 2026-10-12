// P-11 (exa-b8): available() is truthful and synchronous — the seam consults
// it at execution time to select or reject providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerProvider } from '../support/provider.mjs';
import { emulateHostArgv } from '../support/host.mjs';

emulateHostArgv();
delete process.env.EXA_API_KEY;
delete process.env.EXA_TEST_KEY;

const dir = mkdtempSync(join(tmpdir(), 'exa-avail-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('P-11 available() is false with no key source (exa-b8)', async () => {
  const provider = await registerProvider({});
  assert.equal(provider.available(), false);
});

test('P-11 available() is true with a literal apiKey', async () => {
  const provider = await registerProvider({ apiKey: 'literal-key-1' });
  assert.equal(provider.available(), true);
});

test('P-11 available() is true with the env var set', async () => {
  process.env.EXA_TEST_KEY = 'env-key';
  try {
    const provider = await registerProvider({ apiKeyEnv: 'EXA_TEST_KEY' });
    assert.equal(provider.available(), true);
  } finally { delete process.env.EXA_TEST_KEY; }
});

test('P-11 available() is true when a configured key file is readable', async () => {
  const p = join(dir, 'kf');
  writeFileSync(p, 'EXA_TEST_KEY=file-key\n');
  const provider = await registerProvider({ apiKeyEnv: 'EXA_TEST_KEY', apiKeyFile: p });
  assert.equal(provider.available(), true);
});

test('P-11 available() is false when the configured key file is missing', async () => {
  const provider = await registerProvider({ apiKeyFile: join(dir, 'missing') });
  assert.equal(provider.available(), false);
});

test('P-11 available() is true when a credentials service is present', async () => {
  const credentials = { resolve: async () => ({ value: 'cred-key' }) };
  const provider = await registerProvider({}, { credentials });
  assert.equal(provider.available(), true);
});
