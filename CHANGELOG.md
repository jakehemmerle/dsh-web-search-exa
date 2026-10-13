# Changelog — dsh-web-search-exa

All notable changes to this plugin are documented here. The plugin follows
Semantic Versioning with prerelease channels matching the DSH release
channels (see RELEASING.md; the skill's references/release.md).

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
