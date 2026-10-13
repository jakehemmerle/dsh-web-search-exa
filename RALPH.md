# RALPH — dsh-web-search-exa work graph notes

Companion to the beads graph (`bd ready`, `bd list`). Update at the end of every round.

## Round 1 (recovery + bugs) — DONE 2026-10-12

Recovered the interrupted predecessor turn (flake/rig/tests were staged but uncommitted;
package.json test script was broken: trailing-slash directory args crash Node 24's runner —
fixed to glob form). Committed in logical slices, then worked the ready beads:

- s1 source reconcile ✓ (byte-identical to nix-config @ 2db2ca1, HEAD 6a7e613)
- s4 rig vendored ✓ (06d60f9; LOCAL tweaks documented in test/rig/SOURCE.md)
- s3 nix env ✓ (916ad05; `nix flake check`: all checks passed, dsh 0.2.1-alpha.2)
- s2 SPEC.md ✓ (e397d47; P-01..P-23 with oracles + surfaces + bug ledger)
- All nine bug beads closed with red→fix pairs (see TESTING.md table): exa-b1..b8, exa-cmm
- s7 TESTING.md ✓ (traceability + mutants 4/4 + repeat runs)
- s8 ✓ (every bug red→fix committed separately; mutants recorded)
- Beads export committed; suite 36/36 green at NUM_RUNS=1000 (seeds in TESTING.md)

## Round 2 — NEXT

1. `bd ready` → **exa-s5** (P-18: Playwright on real dsh web; mock LLM scripts a web_search
   tool call; mock Exa scenarios; ≥25 sequences; screenshots on failure) and **exa-s6**
   (P-19: real dsh-TUI via vendored rig `startTui`, Launchpad + chat; private tmux socket).
2. Add the P-21 interleaved-searches fast property.
3. Update TESTING.md rows P-18..P-21 with seeds; `bd export`; commit; report.

## Round 2 (s5/s6 harness + campaigns) — DONE 2026-10-12

- Closure audit: all 15 closed beads re-verified (every red/fix sha in git log,
  suites green at NUM_RUNS=1000 on HEAD, honest-gap footnotes don't contradict any
  closure); nothing reopened.
- test/e2e/run.mjs rebuilt: full per-case fixture reset (testing.md rule), 60 s
  gotos, quiescence-based busy check (the old '●' invariant matched the completed
  FOUND text), ASCII encodeURIComponent SAY markers (dsh-TUI width padding inserts
  spaces inside exotic graphemes — observed ' + '`' + '𝆹𝅥𝅮 ⇲' + '`' + ' renders with two spaces).
  No product bug: every fixture-clean case passed against the existing lib.
- P-18 web campaign: 25/25 green, seed 1863135417. P-19 TUI campaign: 25/25 green,
  seed 1375561029. P-20 headless green. TESTING.md "Real-client results — round 2
  replay" updated; per-case artifacts under test/e2e/artifacts/ (gitignored).
- Fast suites 37/37 at NUM_RUNS=1000 re-run on the final tree; nix flake check green.

## Round 3 — release — DONE 2026-10-13

- Closure audit re-run at the gate: all 15 closed beads verified (shas, green
  suites, honest gaps documented, no unfixed findings); nothing reopened.
- Two campaign-discovered harness defects fixed and pushed: '#"-collision in the
  generated search text (mock script replayed an earlier query; generator
  excludes '#' now; 9b6eb5a) and the SAY-marker soft-wrap in the 150-col TUI pane
  (percent-encoded marker split across pane rows; FNV-1a fixed-width hash markers
  now; eb891fe). No product bug — the provider passed every fixture-clean case.
- Release gate (TESTING.md "Release gate (round C, final run)"): fast suites
  37/37 @NUM_RUNS=1000, nix flake check green, mutants 4/4, headless green, and
  101 real-client cases per surface over 5 recorded seeds (FC_SEED replayable).
- Docs: RELEASING.md (procedure), CHANGELOG.md (0.2.1-alpha.1), package.json
  version 0.2.1-alpha.1 with exact peer @deepseek-ai/dsh-web 0.2.1-alpha.2,
  package-lock refreshed, beads s5/s6/s9 closed with evidence, exported.
- Tagged v0.2.1-alpha.1 (annotated, repo-named) and pushed main + tag.

## Post-release — NEXT (out of scope for this round)

- nix-config vendored copy + profile rows still pin the previous import; bump
  them to the tagged release per the new-dsh-plugin rollout flow (Jake's
  acceptance first).

## Round 3 — release (NEXT)

- exa-s9: 4 more recorded seeds x 19 generated cases per surface (release budgets
  ≥100 real-client cases per surface over ≥5 seeds, FC_SEED replayable); then
  RELEASING.md + CHANGELOG.md evidence rows, close s5/s6/s9, tag
  v0.2.1-alpha.1 (exact peer pin 0.2.1-alpha.2), push main + tag.

## Round 3 — release

- exa-s9: RELEASING.md + CHANGELOG.md; full release budgets (≥100 real-client/surface over
  ≥3 seeds); tag `v0.2.1-alpha.1`-style SemVer (plugin 0.2.x, -alpha.N channel) if green.

## Round-1 history note

- b8 amend slip: the exa-cmm red commit (2879c19) was amended while HEAD, folding it into b19a204. Red-run evidence for cmm was captured before the fold (2 failures: P-03 property + example). Documented in TESTING.md.