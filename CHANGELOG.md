# Changelog — dsh-web-search-exa

All notable changes to this plugin are documented here. The plugin follows
Semantic Versioning with prerelease channels matching the DSH release
channels (see RELEASING.md; the skill's references/release.md).

## 0.3.0-rc.1 — 2026-11-02

Installable dsh bundle, qualified against DSH `0.2.1-rc.2` and dsh-TUI `0.17.0`.
The runtime files (`lib/`) are unchanged since 0.2.1-alpha.1.

### Added

- `package.json` declares `dsh.bundle.patch: ./cordis.patch.yml`. The root
  `cordis.patch.yml` pins the web seam's `searchProvider` to `exa` (keeping
  `fetchProvider: http`) and inserts the `web-search-exa` row with
  `apiKeyEnv: EXA_API_KEY`, so `dsh plugin --profile <p> add
  github:jakehemmerle/dsh-web-search-exa#v0.3.0-rc.1` installs a working
  provider. SPEC P-24 and `test/contract/bundle.test.mjs` cover it.
- `nix/package.nix` (the installable root, fast suite in its check phase),
  `nix/e2e` and `nix run .#e2e`, per nix-config's plugin contract, so
  nix-config builds the tagged release instead of a vendored copy.
- README and MIT LICENSE.

### Changed

- Peer `@deepseek-ai/dsh-web` is now exactly `0.2.1-rc.2` (was
  `0.2.1-alpha.2`), so the fleet no longer needs a `dsh plugin
  allow-version` exemption. The test dsh-TUI is the fleet's stock 0.17.0.
- Real-client harness fixes found by the release campaign (TESTING.md):
  hermetic dsh-TUI update check, regex escaping in the TUI driver, and
  Unicode-robust echo detection.

### Tested

Commit tagged `v0.3.0-rc.1`. `nix flake check` green (aarch64-darwin;
40/40 fast tests at NUM_RUNS=1000). Real clients, mock Exa only: headless
P-20 green (store-path row and bundle install); web P-18 and TUI P-19 100
generated cases each over seeds 11, 22, 33, 44, 55, all green.

## 0.2.1-alpha.1 — 2026-10-12

First tagged release of the Exa web_search provider for the DeepSeek
Harness web seam. Search-only provider with no own web or TUI UI
(inertness properties cover both clients). All user-visible behaviour was
defined by SPEC.md and implemented and tested through the beads work graph
(exa-epic); suite evidence lives in TESTING.md.

### Fixed (bug ledger, red -> fix pairs recorded in TESTING.md)

- Errors are the host WebError (HarnessError) with seam codes
  WEB_PROVIDER_ERROR and WEB_PROVIDER_CREDENTIAL_MISSING; HTTP status
  retained (exa-b1).
- Non-JSON 200 bodies no longer surface a raw SyntaxError to the model
  (exa-b2).
- Abort/timeout landing during a 200-body read is wrapped (WEB_ABORTED /
  timeout WEB_PROVIDER_ERROR) instead of escaping as a DOMException (exa-b3).
- String timeoutMs values are coerced; junk values become
  WEB_PROVIDER_ERROR naming the config key instead of TypeError (exa-b4).
- Key files with export KEY= prefixes or quoted values parse to the bare
  key (exa-b5).
- A readable, rotated key file wins over the launch-time environment, per
  the documented no-restart rotation behaviour (exa-b6).
- Upstream error bodies are never echoed into model-visible errors;
  messages carry the HTTP status only (exa-b7).
- available() is truthful over all key sources synchronously; the seam
  degrades to WEB_PROVIDER_CONFIGURED_UNAVAILABLE / WEB_PROVIDER_UNAVAILABLE
  instead of selecting a provider that cannot search (exa-b8).
- Non-string highlight entries in Exa results are skipped when mapping
  snippets instead of being String()-coerced (exa-cmm).

### Tested with

- DSH 0.2.1-alpha.2 (nix-dsh f0ca0d7), dsh-TUI 0.14.0 (stock build for
  tests), Node v24.21.0, fast-check 4.10.2, playwright 1.59.1 (dev only).
- Fast suites: 37/37 at NUM_RUNS=1000 (seed printed per property, FC_SEED
  replayable); nix flake check green (x86_64-linux).
- Real-client campaigns via the vendored rig with a per-case full fixture
  reset: P-18 web (Playwright on real dsh web), P-19 TUI (real dsh-TUI in a
  private tmux socket), P-20 headless. Campaign budgets, seeds and repeated
  runs: TESTING.md. Mutants caught 4/4 (M1..M4).
- Evidence commit: the repository HEAD recorded in TESTING.md "Real-client
  results".

### Peers

- peerDependencies: @deepseek-ai/dsh-web 0.2.1-alpha.2 (exact), matching the
  fleet alpha exception (2026-10-10). A DSH bump re-qualifies the pair and
  re-tags (RELEASING.md).
