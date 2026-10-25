// Locates the pinned DSH under test and loads its real modules by absolute
// path, so contract tests exercise the exact host packages (cordis, dsh-web,
// dsh-llm) the plugin runs against. DSH_ROOT points at
// <dsh store>/lib/node_modules/@deepseek-ai/dsh (the flake devShell and checks
// set it); without it the rig's resolution of DSH_BIN / the managed launcher
// is used.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { paths } from '../rig/rig.mjs';

export function dshRoot() {
  const root = process.env.DSH_ROOT ?? paths().dshRoot;
  if (!root || !existsSync(join(root, 'package.json'))) {
    throw new Error('test/support/host.mjs: set DSH_ROOT to <dsh>/lib/node_modules/@deepseek-ai/dsh (nix develop does)');
  }
  return root;
}

export const dshVersion = () => JSON.parse(readFileSync(join(dshRoot(), 'package.json'), 'utf8')).version;

export function hostPackageDir(name) {
  return join(dshRoot(), 'node_modules', name);
}

export function hostImport(name, file = 'lib/index.js') {
  return import(pathToFileURL(join(hostPackageDir(name), file)).href);
}

/**
 * Make this process look like the dsh launcher to the plugin: dsh runs
 * <dsh>/lib/bin.js, and the plugin resolves host packages from process.argv[1].
 */
export function emulateHostArgv() {
  process.argv[1] = join(dshRoot(), 'lib', 'bin.js');
}

/**
 * Boot the real host composition the plugin meets in a profile: Cordis root,
 * the dsh-web seam, the launcher's frozen launch-environment snapshot and
 * dsh-base's `dsh-credentials-local` (watch off; writes publish through the
 * seam's reference-updated event). `launchEnv` is the inherited process layer
 * the launcher froze at start, so later process.env edits never reach it.
 */
export async function bootComposition({ launchEnv = {}, dshHome, webConfig = { searchProvider: 'exa' }, credentials = true } = {}) {
  const [cordis, web, launch, local] = await Promise.all([
    hostImport('@deepseek-ai/cordis'),
    hostImport('@deepseek-ai/dsh-web'),
    hostImport('@deepseek-ai/dsh-launch-environment'),
    hostImport('@deepseek-ai/dsh-credentials-local'),
  ]);
  const root = new cordis.Context();
  root.provide(launch.DSH_LAUNCH_ENVIRONMENT_KEY, launch.createLaunchEnvironmentSnapshot([{ source: 'process', values: launchEnv }]));
  await root.plugin(web.WebRuntime, webConfig);
  if (credentials) await root.plugin(local.LocalCredentialProvider, { dshHome, watch: false });
  return { root, WebError: web.WebError };
}

export async function hostModules() {
  const [cordis, web, llm] = await Promise.all([
    hostImport('@deepseek-ai/cordis'),
    hostImport('@deepseek-ai/dsh-web'),
    hostImport('@deepseek-ai/dsh-llm'),
  ]);
  return { Context: cordis.Context, WebRuntime: web.WebRuntime, WebError: web.WebError, HarnessError: llm.HarnessError };
}
