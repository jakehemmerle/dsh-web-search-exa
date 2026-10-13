# RELEASING — dsh-web-search-exa

SemVer release procedure per `new-dsh-plugin` skill `references/release.md`.
All versions are prereleases in the DSH-official channels while DSH itself
ships prereleases only (observed 2026-10-11: latest `0.2.1-alpha.2`).

## Preconditions

1. `git pull --ff-only` on a clean `main`; working tree only has the release files.
2. Every release-blocking bead is closed (check `bd ready`).
3. The pair under test: **DSH `0.2.1-alpha.2`** (nix-dsh `f0ca0d7`) and **dsh-TUI `0.14.0`** (stock build), pinned in `flake.lock` and `test/contract/seam.test.mjs` P-23.

## Gate (all green or no release)

Fast, no-network suites in the Nix sandbox:

    nix flake check                 # runs checks.fast at NUM_RUNS=1000
    NUM_RUNS=1000 npm test          # locally, 36 unit/contract tests

Real-client suites against the pinned builds (must all be green, no skipped
required suite):

    nix run .#e2e -- headless
    nix run .#e2e -- web --runs N   # seams and tool turns driven by Playwright
    nix run .#e2e -- tui --runs N   # real dsh-TUI in a private tmux socket

Release budgets ( TESTING.md "Real-client results" records the evidence):

- fast properties: ≥1000 cases each; seeds printed per property
- real-client campaigns: ≥100 generated cases per surface, spread over ≥5
  recorded seeds (Jake's minimum: 3); Failure artifacts land in
  `test/e2e/artifacts/` (gitignored) and DIAG notes the exact actions.
- replay: any failed case replays with `FC_SEED=<seed>` (and `FC_PATH`).

Failures on the gate block the release; there is no bypass. Bugs found by a
campaign become red commits (`5.3 FLASH: red: exa-h# …`) then fix commits,
with TESTING.md updated.

## Steps

1. Bump `package.json`: version `MAJOR.MINOR.PATCH[-channel.N]` (0.x: breaking
   changes bump MINOR). While the pair above is only an alpha, the plugin
   carries the matching `-alpha.N` channel; refresh
   `package-lock.json` with `npm install --package-lock-only`. Keep the
   flake package version derived from the manifest (it is).
2. `peerDependencies` pin the DSH packages imported at runtime **exactly** to
   the version every suite ran against: currently
   `@deepseek-ai/dsh-web": "0.2.1-alpha.2"`. A DSH bump re-runs every suite,
   bumps both, and records the tested pair — never ship a peer change without
   that run.
3. Add a `CHANGELOG.md` entry: version, date, user-visible changes, the
   exact DSH and dsh-TUI versions, the tested commit, and suite evidence
   (seeds, counts, pass).
4. Commit `5.3 FLASH: release: vX.Y.Z[-channel.N]`, create the annotated tag
   `vX.Y.Z[-channel.N]` on that commit, push main and the tag:

       git tag -a vX.Y.Z-alpha.N -m "web-search-exa vX.Y.Z-alpha.N (dsh 0.2.1-alpha.2, dsh-TUI 0.14.0)"
       git push origin main --follow-tags

5. Tag namespace is per-repo: dsh-speed also has a \</code>v0.2.1-alpha.1\</code>; tags are created on this repo (dsh-web-search-exa) with our own package.json 0.2.1-alpha.1. The CHANGELOG header is the authoritative version line for this repo.
6. Consumers (nix-config) pin tagged revisions only. Fleet rollout follows
   the skill's rollout.md — Jake's acceptance first, then per-host
   verification; nothing here deploys.