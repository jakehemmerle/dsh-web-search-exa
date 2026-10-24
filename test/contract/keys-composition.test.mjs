// P-05 / P-11 in the real host composition: the plugin mounted beside the
// pinned dsh-web seam, the launcher's frozen launch-environment snapshot and
// dsh-base's dsh-credentials-local — the services every deployed profile has.
// The oracle is SPEC.md P-05/P-11 only: a configured key file is read per
// search and wins over the launch-time environment; available() is true only
// when some source actually yields a key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as plugin from '../../lib/index.js';
import { emulateHostArgv, bootComposition } from '../support/host.mjs';
import { startMockExa } from '../support/mock-exa.mjs';

emulateHostArgv();
delete process.env.EXA_API_KEY;

const dir = mkdtempSync(join(tmpdir(), 'exa-composition-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const fresh = (name) => join(dir, `${name}-${n += 1}`);

async function compose({ launchEnv = {}, keyFile, apiKey } = {}) {
  const exa = await startMockExa();
  const dshHome = fresh('home');
  const { root, WebError } = await bootComposition({ launchEnv, dshHome });
  const config = { baseURL: exa.baseURL, apiKeyEnv: 'EXA_API_KEY' };
  if (keyFile) config.apiKeyFile = keyFile;
  if (apiKey) config.apiKey = apiKey;
  const fiber = root.plugin(plugin, config);
  await fiber;
  const sentKeys = () => exa.searches().map((r) => r.headers['x-api-key']);
  const search = (query = 'q') => root.web.search({ query }).then((r) => r, (e) => e);
  const provider = () => root.web.searchProviders.get('exa');
  return { root, exa, WebError, sentKeys, search, provider, async close() { await fiber.dispose(); await exa.close(); } };
}

test('P-05 a configured key file wins over the launch-time environment in the real composition (rotation without restart)', async () => {
  const keyFile = fresh('exa.env');
  writeFileSync(keyFile, 'EXA_API_KEY=rotated-file-key-1\n');
  const c = await compose({ launchEnv: { EXA_API_KEY: 'stale-launch-key' }, keyFile });
  try {
    await c.search();
    writeFileSync(keyFile, 'EXA_API_KEY=rotated-file-key-2\n');
    await c.search();
    assert.deepEqual(c.sentKeys(), ['rotated-file-key-1', 'rotated-file-key-2']);
  } finally { await c.close(); }
});

test('P-05 without a key in the file the credentials service (launch env) supplies the key', async () => {
  const keyFile = fresh('exa.env');
  writeFileSync(keyFile, 'OTHER=1\n');
  const c = await compose({ launchEnv: { EXA_API_KEY: 'launch-key' }, keyFile });
  try {
    await c.search();
    unlinkSync(keyFile);
    await c.search();
    assert.deepEqual(c.sentKeys(), ['launch-key', 'launch-key']);
  } finally { await c.close(); }
});

test('P-05 a literal apiKey wins over the key file and the credentials service', async () => {
  const keyFile = fresh('exa.env');
  writeFileSync(keyFile, 'EXA_API_KEY=file-key\n');
  const c = await compose({ launchEnv: { EXA_API_KEY: 'launch-key' }, keyFile, apiKey: 'literal-key' });
  try {
    await c.search();
    assert.deepEqual(c.sentKeys(), ['literal-key']);
  } finally { await c.close(); }
});
