# SPEC — dsh-web-search-exa

Exa web_search provider for the DeepSeek Harness web seam (`ctx.web`). This spec is the
acceptance oracle for every test in `test/`; tests must not read implementation code to
compute expected results.

## Product

Registers one search provider (`id: "exa"`) on the `@deepseek-ai/dsh-web` seam. A chat turn
(web, dsh-TUI or headless) that calls the `web_search` tool resolves through the seam to this
provider, which POSTs to the Exa `/search` API and maps the response into seam sources.

**Scope.** Search only (no fetch provider), one provider, no own user interface.

**Non-goals.** No UI slots, scenes or shortcuts; no key management UI; no result caching.

**Surfaces.** The provider runs inside the `dsh web` server process and is reached through the
seam by all three clients. There is **no own web UI and no own TUI UI** (rationale per the
product decision above): the surface tests are (a) seam-level properties in-process against the
real pinned `@deepseek-ai/dsh-web`, and (b) real-client end-to-end inertness + tool-turn
properties — Playwright on `dsh web` (s5), real dsh-TUI in a private tmux socket (s6) — that
prove the plugin changes no visible client behavior and that `web_search` turns work.

## Versions (temporary alpha exception, 2026-10-10)

- DSH `0.2.1-alpha.2` (nix-dsh `f0ca0d7`), dsh-TUI `0.14.0`. Peers pinned **exact** in
  `package.json` per `references/release.md`; plugin version carries `-alpha.N` until a stable DSH.

## Error contract (aligned with the reference provider `dsh-web-search-deepseek`)

All thrown errors are instances of the host `WebError` from `@deepseek-ai/dsh-web`
(a `HarnessError` subclass from `@deepseek-ai/dsh-llm`), so the tool layer keeps
`error.info.code`. Codes: `WEB_PROVIDER_ERROR` (provider failure: HTTP rejection, unparseable
body, timeout, invalid config), `WEB_ABORTED` (caller cancellation),
`WEB_PROVIDER_CREDENTIAL_MISSING` (no usable API key).

## Properties

| ID | Property (observable oracle) | Independent oracle | Surface | Test |
|---|---|---|---|---|
| P-01 | Plugin exports `name: "web-search-exa"`, `inject: ["web"]`; `apply` registers provider `exa`. With no `searchProvider` configured, the seam auto-selects exa when it is the only registered usable provider | `root.web.searchProviders.has("exa")`; `root.web.search()` succeeds with empty seam config | seam | `test/contract/seam.test.mjs` |
| P-02 | Outgoing request is `POST <baseURL>/search` (trailing `/` stripped), headers `x-api-key` + `content-type: application/json`, body exactly `{query, type ?? "auto", contents.highlights.maxCharacters ?? 600}` plus `numResults` iff `maxResults` given | mock Exa request record compared field-by-field | seam (fetch recorded) | `test/unit/request.test.mjs` (fast-check, seed logged) + e2e |
| P-03 | Exa results map to seam sources: keep entries with non-empty string `url`; `title` iff non-empty string; `snippet` = trimmed **string** `highlights` entries joined `" … "` (non-string entries skipped, exa-cmm), else trimmed `summary`, else `text` trimmed and sliced to 600 chars; `publishedAt` iff non-empty string `publishedDate`; `truncated: false`; junk-shaped bodies yield `sources: []` | `expectedSources()` in `test/unit/mapping.test.mjs`, written from this row only | seam | `test/unit/mapping.test.mjs` (fast-check + deterministic example) |
| P-04 | Seam caps `sources` to `maxResults`, sets `truncated` iff it cut, and `numResults` was forwarded to Exa | capSources semantics from the seam contract | seam | `test/contract/seam.test.mjs` P-04 |
| P-05 | Key resolution order per search: literal `apiKey` → `credentials.resolve(apiKeyEnv)` → **key file** when `apiKeyFile` is configured and yields a key (a rotated file wins without restart, exa-b6) → `process.env[apiKeyEnv]` | try sources in order, first yield wins | seam (config/credentials fakes) | `test/unit/keys.test.mjs` + exa-b6 red/fix |
| P-06 | Key file formats: raw file = trimmed content; dotenv file = **last** line `apiKeyName=value`; `export NAME=value` prefix stripped (exa-b5); single/double-quoted values unquoted (exa-b5); missing/unreadable file or no matching line → no key, **no HTTP request** | file parser written from this row | seam | `test/unit/keys.test.mjs` + exa-b5 red/fix |
| P-07 | 200 response with unparseable body (HTML, garbage, truncated JSON) → `WebError` code `WEB_PROVIDER_ERROR` with a clear message; never a raw `SyntaxError`; upstream body not echoed | assert error type/code and that message contains no body fragment | seam | exa-b2 red/fix |
| P-08 | Caller `AbortSignal` fires → `WebError` `WEB_ABORTED` with the abort reason as `cause`, including an abort that lands **during the body read** (exa-b3) | abort controller driven by the test | seam | exa-b3 red/fix |
| P-09 | Provider timeout (default 30000 ms, `timeoutMs` config) → `WebError` `WEB_PROVIDER_ERROR` whose message names the timeout, including a timeout that lands during the body read (exa-b3) | slow mock Exa (`delayMs`/`bodyDelayMs`) + fake timers or short timeout | seam | exa-b3 red/fix |
| P-10 | Non-OK HTTP status → `WebError` `WEB_PROVIDER_ERROR`; `error.status` = HTTP status; message contains the status but **never** the upstream body or the API key (exa-b7) | error fields inspected against sent key/body | seam | exa-b7 red/fix |
| P-11 | `available()` is truthful and synchronous (exa-b8): `true` iff a literal key is configured, or `process.env[apiKeyEnv]` is set, or a configured key file is readable, or a credentials service is present; otherwise `false`. The seam then reports `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` (configured) or `WEB_PROVIDER_UNAVAILABLE` (auto-select) instead of calling `search` | boolean from the four conditions; seam selection outcome | seam | exa-b8 red/fix |
| P-12 | `timeoutMs` validation (exa-b4): finite positive number accepted; numeric string coerced; anything else → `WebError` `WEB_PROVIDER_ERROR` naming the config key; never a `TypeError` | value classification table | seam | exa-b4 red/fix |
| P-13 | Every thrown error `instanceof` host `WebError` (hence `HarnessError`), `name === "WebError"`, `code` preserved into tool-result `error.info.code` (exa-b1) | `instanceof` checks against modules imported from the pinned host, plus the `dsh-tools` errorInfo source shape | seam | `test/contract/seam.test.mjs` P-23 + exa-b1 red/fix |
| P-14 | Config is re-read on every search: live config objects (`.get()`) apply without re-registration | two searches with mutated config differ | seam | `test/unit/config.test.mjs` |
| P-15 | `dispose()` of the plugin fiber unregisters `exa`; seam then throws `WEB_PROVIDER_CONFIGURED_MISSING` and mock Exa saw no request | provider map before/after dispose | seam | `test/contract/seam.test.mjs` P-15 |
| P-16 | No usable key at search time → `WebError` `WEB_PROVIDER_CREDENTIAL_MISSING` with an actionable message naming `apiKeyEnv`/`apiKeyFile` | error code + message substrings | seam | exa-b1 red/fix (typed errors) |
| P-17 | Secret hygiene: the API key never appears in any thrown error message or mapped result, even when the upstream echoes it | substring search over error/result material | seam | exa-b7 red/fix |
| P-18 | **Web client inertness + tool turn** (s5): with the plugin loaded in a real `dsh web`, the chat UI renders and streams exactly as without it (no added UI, no console/page errors beyond an allowlist), and a mock-LLM-scripted `web_search` tool call completes with sources delivered to the model; generated chat-turn sequences (≥25/round, seeds logged, screenshots on failure) | DOM/stream assertions vs no-plugin baseline; mock Exa saw the scripted query | real dsh web + Playwright | `test/e2e/run.mjs web` |
| P-19 | **TUI inertness + tool turn** (s6): same properties on a real dsh-TUI in a private tmux socket, Launchpad first prompt and chat follow-up; terminal frames stay intact; web_search turn completes | pane text invariants vs baseline; mock Exa saw the query | real dsh-TUI | `test/e2e/run.mjs tui` |
| P-20 | **Headless tool turn**: `runHeadless` web_search turn completes through the provider | NDJSON run events + mock Exa record | real dsh headless | `test/e2e/run.mjs headless` |
| P-21 | Interleaved searches (two in-flight requests) each get their own results; no cross-talk of keys/bodies | two awaited searches with different mock responses | seam | fast property in `test/unit/` (added with s5 round) |
| P-22 | Version qualification: suites run against exactly DSH `0.2.1-alpha.2` / dsh-TUI `0.14.0`; peers pinned exact; the pair is recorded in every evidence table | `dshVersion()` + package.json assertions | build | `test/contract/seam.test.mjs` P-23 |
| P-23 | Host seam contract: `WebRuntime.registerSearchProvider/search` signatures used by this plugin, `WebError extends HarnessError`, `dsh-tools` keeps `{name, code}` in tool error info only for `HarnessError` | source/shape assertions against the pinned host packages | build | `test/contract/seam.test.mjs` |

## Execution

- Fast suites (no network, mock Exa on loopback): `NUM_RUNS=1000 npm test`. `FC_SEED`/`FC_PATH`
  replay a failure; seeds are printed per property. Release gate: `nix flake check` (runs
  `checks.fast` in the sandbox at NUM_RUNS=1000).
- Real-client suites: `nix run .#e2e -- [web|tui|headless|all]` against the pinned builds.
- Budgets: fast properties ≥1000 cases; real-client ≥25 sequences/surface/round, ≥100/surface
  over ≥3 seeds for the release run.

## Bug ledger (red commit → fix commit)

| Bead | Property | Symptom |
|---|---|---|
| exa-b1 | P-13, P-16 | errors are plain `Error` named `WebError` — not the host class; codes dropped from tool results; `WEB_PROVIDER_FAILED` ≠ reference `WEB_PROVIDER_ERROR` |
| exa-b2 | P-07 | non-JSON 200 surfaces `SyntaxError` |
| exa-b3 | P-08, P-09 | abort/timeout during body read escapes as `DOMException` |
| exa-b4 | P-12 | string `timeoutMs` → `TypeError` from `AbortSignal.timeout` |
| exa-b5 | P-06 | `export KEY=` / quoted dotenv lines sent raw |
| exa-b6 | P-05 | launch-time env beats rotated key file, contradicting the per-search comment |
| exa-b7 | P-10, P-17 | upstream error body (≤500 chars) echoed into model-visible errors |
| exa-b8 | P-11 | `available()` always `true` |
| exa-cmm | P-03 | non-string highlight entries `String()`-coerced into snippets |
