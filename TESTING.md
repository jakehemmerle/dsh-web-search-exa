# TESTING — dsh-web-search-exa

Evidence per `SPEC.md` properties. Oracle-first: expected values come from the spec table and
independent oracles in the tests, never from `lib/`.

## Versions under test

- DSH `0.2.1-alpha.2` (store `i24c2k38bz3h86r0v7bjr4amk7d4vxrj`, nix-dsh `f0ca0d7`) — the pinned fleet alpha
- dsh-TUI `0.14.0` (store `inl2nrkcnbp50r1yq7fh5y0zibx96gvl`, stock build for tests)
- Node `v24.21.0`; fast-check `4.10.2`; playwright `1.59.1` (dev only)
- `nix flake check`: all 4 checks passed (x86_64-linux) incl. sandboxed `checks.fast` at NUM_RUNS=1000

## Commands

- Fast suites: `NUM_RUNS=1000 npm test` (unit + contract; loopback mock Exa, no network)
- Replay: `FC_SEED=<seed> node --test test/unit/<file>` (seeds printed per property)
- Release gate: `nix flake check` · Real-client: `nix run .#e2e -- [web|tui|headless|all]`

## Traceability

| Property | Test | Surface | Result / seed |
|---|---|---|---|
| P-01 | `test/contract/seam.test.mjs` (2 tests) | seam (pinned host) | green |
| P-02 | `test/unit/request.test.mjs` | seam fetch record | green, 1000 runs; seeds 332565088, 733069453 |
| P-03 | `test/unit/mapping.test.mjs` (property + 2 examples) | seam | green, 1000 runs; seeds 1520686399, 2087062941 |
| P-04 | `test/contract/seam.test.mjs` P-04 | seam cap | green |
| P-05 | `test/unit/keys.test.mjs` P-05 (4 tests incl. exa-b6) | seam | green |
| P-06 | `test/unit/keys.test.mjs` P-06 (7 tests incl. exa-b5) | seam | green |
| P-07 | `test/unit/errors.test.mjs` P-07 (exa-b2) | seam | green |
| P-08 | `test/unit/errors.test.mjs` P-08 (exa-b3) | seam | green |
| P-09 | `test/unit/errors.test.mjs` P-09 (exa-b3) | seam | green |
| P-10, P-17 | `test/unit/errors.test.mjs` P-10/P-17 (exa-b7) | seam | green |
| P-11 | `test/unit/availability.test.mjs` (exa-b8, 6 tests) | seam | green |
| P-12 | `test/unit/errors.test.mjs` P-12 (exa-b4) | seam | green |
| P-13, P-16 | `test/unit/errors.test.mjs` P-13/P-16 (exa-b1) | seam | green |
| P-14 | `test/unit/config.test.mjs` | seam | green |
| P-15 | `test/contract/seam.test.mjs` P-15 | seam dispose | green |
| P-18 (web inertness + tool turn) | `test/e2e/run.mjs web` | real dsh web + Playwright (system Chrome) | see "Real-client results" below |
| P-19 (TUI inertness + tool turn) | `test/e2e/run.mjs tui` | real dsh-TUI, private tmux socket | see "Real-client results" below |
| P-20 (headless tool turn) | `test/e2e/run.mjs headless` | real dsh headless | green (sources rendered; query + x-api-key asserted on the mock Exa record) |
| P-21 (interleaved searches) | `test/unit/interleave.test.mjs` | seam (loopback mock Exa) | green, 300 runs; seed -934724820 |
| P-22 | `test/contract/seam.test.mjs` P-23 pins versions | build | green |
| P-23 | `test/contract/seam.test.mjs` P-23 (2 tests) | host seam contract | green |

No required test is skipped.

## Real-client results (round A, exa-s5/exa-s6)

Harness: `node test/e2e/run.mjs [web|tui|headless|all] [--runs N]` — rig profiles (private
HOME/DSH_HOME, port 0, private tmux socket), mock LLM scripts `web_search` tool calls, mock
Exa answers /search locally; plugin row pinned `searchProvider: "exa"` (dsh-base ships a
competing web-search-deepseek provider); workspace picker flow per dsh-speed's proven setup.

- **P-18 web**: inertness baseline (plain turn renders with the plugin loaded, no
  console/page errors beyond the allowlisted `/open-in-app/icon/` 404) + generated
  say/search/reload sequences with per-step invariants (exa request count, x-api-key on every
  request, query present, composer usable, no page errors). Failure screenshots + action
  traces saved to `test/e2e/artifacts/`. RESULT: <PENDING-BUDGET>
- **P-19 TUI**: Launchpad (first prompt) and chat follow-ups with generated say/search
  actions; per-step invariants (exa count, key, source URL rendered in the pane, no
  `[[exited`, idle before next action). RESULT: <PENDING-BUDGET>
- **P-20 headless**: green.
- Mutants M1-M4 above were caught by these suites' fast layers; the e2e layers add the
  serialized-request and rendered-output assertions.

## Red → fix pairs (each red committed alone, suite green at its fix)

| Bead | Property | red → fix |
|---|---|---|
| exa-b1 | P-13, P-16 | `39efebb` → `c0eed96` |
| exa-b2 | P-07 | `f730856` → `5ba7d3a` |
| exa-b3 | P-08, P-09 | `a606b21` → `61b3d02` |
| exa-b4 | P-12 | `815095e` → `95e5232` |
| exa-b5 | P-06 | `6d172db` → `39fb669` |
| exa-b6 | P-05 | `1e1459d` → `6b79426` |
| exa-b7 | P-10, P-17 | `f8d8384` → `1da1c97` |
| exa-b8 | P-11 | `e380930` → `b19a204` |
| exa-cmm | P-03 | red `2879c19` (dangling: an amend slip folded the red test into `b19a204` when it was HEAD; red run evidence preserved above and in RALPH.md) → fix `7831494` |

## Mutants (caught 4/4, against the real lib, restored after each)

| Mutant | Killed by |
|---|---|
| M1: dropped the non-string guard in `snippetOf` | P-03 property + example (2 fail) |
| M2: renamed the `x-api-key` header | P-02 (1 fail) |
| M3: snippet slice 600 → 601 | P-03 example + property (2 fail) |
| M4: removed `timeoutMs` validation | P-12 (1 fail) |

## History note

- `2245a60` is a broken intermediate b8 fix (committed before its suite was green during
  recovery); corrected in the next commit `b19a204`. Final state green; kept unamended
  because it was already pushed. The exa-cmm red commit was folded into `b19a204` by the
  same amend slip.

## Repeat runs

- 3× consecutive full suites at NUM_RUNS=200: 36/36 pass each run (no flake observed)
- Release campaign budgets (≥1000 fast, ≥100 real-client per surface over ≥3 seeds) are the round-3 gate (exa-s9)