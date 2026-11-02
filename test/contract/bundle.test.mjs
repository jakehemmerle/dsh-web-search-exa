// Contract suite for P-24, the installable bundle: package.json declares
// dsh.bundle, the real pinned dsh composes the package's cordis.patch.yml into
// a profile exactly as `dsh plugin add` leaves it (package in the profile's
// node_modules, name appended to dsh.profile.bundles), and the composed row,
// resolved by package name from that profile, registers the `exa` provider
// that the composed web seam selects. No network: dsh only dumps the tree,
// and the search goes to the local mock Exa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dshRoot, emulateHostArgv, hostModules } from '../support/host.mjs';
import { startMockExa, EXA_OK } from '../support/mock-exa.mjs';

emulateHostArgv();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const { Context, WebRuntime } = await hostModules();
const YAML = createRequire(join(dshRoot(), 'package.json'))('yaml');
// <dsh>/lib/node_modules/@deepseek-ai/dsh -> <dsh>/bin/dsh
const dshBin = process.env.DSH_BIN ?? join(dshRoot(), '..', '..', '..', '..', 'bin', 'dsh');

function dsh(args, env) {
  return new Promise((resolve) => {
    const child = spawn(dshBin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (status) => resolve({ status, stdout, stderr }));
  });
}

/** A private DSH_HOME whose headless profile has this package installed as a bundle. */
async function composedProfile({ keep = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'exa-bundle-'));
  const dshHome = join(root, '.dsh');
  const dir = join(dshHome, 'profiles', 'headless');
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  symlinkSync(ROOT, join(dir, 'node_modules', manifest.name));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-headless', private: true,
    dependencies: { [manifest.name]: 'link:' + ROOT },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', manifest.name] } } }));
  writeFileSync(join(dir, 'cordis.yml'), '[]\n');
  writeFileSync(join(dir, 'cordis.patch.yml'), '[]\n');
  const env = { PATH: process.env.PATH ?? '', HOME: root, DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: '1' };
  const dump = await dsh(['--profile', 'headless', '--dump-config'], env);
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  if (!keep) cleanup();
  assert.equal(dump.status, 0, 'dsh --dump-config failed:\n' + dump.stderr);
  return { dir, tree: YAML.parse(dump.stdout), text: dump.stdout, cleanup };
}

const rowsOf = (tree, id) => tree.filter((row) => row && row.id === id);

test('P-24 package.json declares an installable dsh.bundle with exact DSH peers', () => {
  assert.deepEqual(manifest.dsh?.bundle, { patch: './cordis.patch.yml' });
  assert.ok(manifest.files.includes('cordis.patch.yml'), 'the patch ships in the packed tarball');
  assert.equal(manifest.dependencies, undefined, 'official packages are peers, not dependencies');
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    assert.match(name, /^@deepseek-ai\//);
    assert.match(range, /^\d+\.\d+\.\d+(-[\w.]+)?$/, `${name} is pinned to the exact qualified DSH version`);
  }
  const layer = YAML.parse(readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8'));
  assert.ok(!JSON.stringify(layer).match(/apiKey"\s*:/), 'the bundle layer carries no literal key');
});

test('P-24 the real dsh composes the bundle: web pinned to exa, web-search-exa row by package name', async () => {
  const { tree, text } = await composedProfile();
  const web = rowsOf(tree, 'web');
  assert.equal(web.length, 1);
  assert.deepEqual(web[0].config, { searchProvider: 'exa', fetchProvider: 'http' });
  assert.match(text, /# == @deepseek-ai\/dsh-base, patched by dsh-web-search-exa\n- id: web\n/);
  const exa = rowsOf(tree, 'web-search-exa');
  assert.equal(exa.length, 1, 'exactly one web-search-exa row');
  assert.equal(exa[0].name, manifest.name);
  assert.deepEqual(exa[0].config, { apiKeyEnv: 'EXA_API_KEY' });
  assert.equal(rowsOf(tree, 'web-search-deepseek').length, 1, 'the stock provider stays; only the pin moves');
});

test('P-24 the composed row registers exa and the composed web config routes search to it', async () => {
  const { dir, tree, cleanup } = await composedProfile({ keep: true });
  // The Loader resolves a bare row name from the profile's node_modules,
  // where `dsh plugin add link:` leaves the package.
  let plugin;
  try {
    const entry = createRequire(join(dir, 'package.json')).resolve(rowsOf(tree, 'web-search-exa')[0].name);
    plugin = await import(pathToFileURL(entry).href);
  } finally { cleanup(); }

  const mock = await startMockExa();
  const saved = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = 'bundle-contract-key';
  const root = new Context();
  await root.plugin(WebRuntime, rowsOf(tree, 'web')[0].config);
  const fiber = root.plugin(plugin, { ...rowsOf(tree, 'web-search-exa')[0].config, baseURL: mock.baseURL });
  await fiber;
  try {
    assert.ok(root.web.searchProviders.has('exa'), 'provider exa registered');
    const result = await root.web.search({ query: 'bundle' });
    assert.deepEqual(result.sources.map((s) => s.url), EXA_OK('bundle').json.results.map((r) => r.url));
    assert.equal(mock.searches().length, 1);
    assert.equal(mock.searches()[0].headers['x-api-key'], 'bundle-contract-key', 'key read from apiKeyEnv');
  } finally {
    await fiber.dispose();
    await mock.close();
    if (saved === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = saved;
  }
});
