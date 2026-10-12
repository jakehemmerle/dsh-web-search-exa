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

## Round 3 — release

- exa-s9: RELEASING.md + CHANGELOG.md; full release budgets (≥100 real-client/surface over
  ≥3 seeds); tag `v0.2.1-alpha.1`-style SemVer (plugin 0.2.x, -alpha.N channel) if green.
