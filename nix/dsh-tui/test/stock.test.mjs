import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Stock dsh-TUI 0.17.0 as installed by pkgs/dsh-tui.nix, before any fleet
// contribution. These pin the facts that let the fleet drop its old patches.
const types = process.env.DSH_TUI_TYPES;
assert.ok(types, 'Set DSH_TUI_TYPES to the installed dsh-tui lib/types directory');
const pkg = dirname(dirname(types));

test('runtime manifest keeps the published peers plus the unlisted host packages', async () => {
  const manifest = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'));
  for (const name of ['@deepseek-ai/dsh-session-persistence', '@deepseek-ai/dsh-session-persistence-jsonl', '@deepseek-ai/dsh-mcp-client', '@deepseek-ai/dsh-base']) {
    assert.ok(manifest.peerDependencies[name], name);
    assert.equal(manifest.peerDependenciesMeta[name]?.optional, true, name);
  }
  assert.ok(manifest.peerDependencies['@deepseek-ai/dsh-session'], 'published peers survive');
});

test('bundled @dsh-std packages are restored after npm ci', async () => {
  for (const name of ['core', 'connection', 'messages']) {
    assert.ok((await stat(join(pkg, 'node_modules/@dsh-std', name, 'package.json'))).isFile(), name);
  }
});

test('the Launchpad handles Ctrl+W natively (launchpad-word-edit.patch retired)', async () => {
  const source = await readFile(join(types, 'screens/Launchpad.js'), 'utf8');
  assert.match(source, /isMod\(key\) && input === 'w'/);
});

test('bundled presets no longer deny schedule_* to subagents (preset-schedule-deny.patch retired, dsh-TUI#1450)', async () => {
  const source = await readFile(join(types, 'dsh-adapter/bundled-presets.js'), 'utf8');
  assert.doesNotMatch(source, /schedule_(create|list|update|delete)/);
});
