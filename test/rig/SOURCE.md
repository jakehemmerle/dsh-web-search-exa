# Vendored rig

`rig.mjs` and `mock-llm.mjs` are copied from
`jakehemmerle/nix-config` `skills/new-dsh-plugin/scripts/` at commit
`2d658d4187ce36db8ff01936620950dc44f760d2` (last change to those files;
nix-config HEAD was `6a7e6130ea0f45cdf0f3ea51b99565c9264df564` when copied,
2026-10-11).

Upstream sha256:

- rig.mjs `4a79aeb02e5c419eb4dbf16396eb0812e1343147ddf1fe084f775c99e0382d93`
- mock-llm.mjs `a44562f2f5f1754692fcc3f28f5e19d22f83ddf7b98b423ce90ddc607d8695f1` (unchanged)

Tests import these by relative path (`../rig/rig.mjs`). Never import the
skill from `~/.agents`: that path does not exist in CI or the Nix sandbox.

Local changes to rig.mjs (marked `LOCAL`):

1. Every tmux call passes `-f /dev/null`, so the private `-L` server never
   reads a user tmux.conf.
2. `startTui` forwards `profile.passEnv` names in addition to the fixed list
   (the Exa key-source tests need `EXA_API_KEY`/custom env in the TUI).
