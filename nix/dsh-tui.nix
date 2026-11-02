{ lib, buildNpmPackage, fetchNpmDeps, fetchurl, jq, runCommand, nodejs, plugins ? [ ] }:

# Copied verbatim from jakehemmerle/nix-config pkgs/dsh-tui.nix (with
# pkgs/dsh-tui/package-lock.json and test/stock.test.mjs) at e580478, so the
# real-client suites run the fleet's stock dsh-TUI 0.17.0. This repo patches
# nothing in dsh-TUI; set DSH_TUI_DIR to test the fleet's patched build.
#
# dsh-TUI, the community terminal front end for DeepSeek Harness
# (https://github.com/ccch1mneyyy/dsh-TUI), installed as the dsh-tui profile's
# bundle by home/dsh.nix. Same shape as nix-dsh's dsh-tui.nix (which still
# packages 0.15.0): the stock release is the base, and pkgs/dsh-fleet.nix
# applies the fleet's contributions with `override { plugins = [ ... ]; }`.
# Each element is what a plugin repo's nix/tui-patch.nix returns:
#   { name; patches ? [ ]; postPatch ? ""; installCheck ? ""; }
# installCheck runs after installation with DSH_TUI_TYPES (the installed
# lib/types) and an empty HOME, so it tests the exact artifact.
#
# The npm tarball ships no lockfile; ours was made with
#   npm install --package-lock-only --omit=dev --legacy-peer-deps --ignore-scripts
# against the manifest edited exactly as in `src`. Peers are DSH's own
# packages, which the dsh Loader supplies at runtime, so they are not
# installed. sharp is dropped too: dsh-TUI loads the host's sharp first
# (lib/types/dsh-adapter/sharp.js); a second libvips copy only duplicates it.
# To update: bump version and hash, regenerate dsh-tui/package-lock.json,
# recheck unlistedPeers with the README command, then fix the npmDeps hash.
let
  version = "0.17.0";
  tarball = fetchurl {
    url = "https://registry.npmjs.org/@deepseek-harness-tui/dsh-tui/-/dsh-tui-${version}.tgz";
    hash = "sha512-gQ/hzvHugDhJjQJ1nWOMjjL9HDBLeVVjChzorZb7PZGIa6Fs7Qgfe7WouUMkFVamQMIr+pdDkT/i0cXhYYwnBA==";
  };
  # DSH packages dsh-TUI imports or names without listing them as peers. dsh
  # routes a store-linked package's @deepseek-ai/* imports to its own copies
  # only for names listed there, so they are added as optional peers.
  unlistedPeers = [
    "@deepseek-ai/cordis-plugin-include"
    "@deepseek-ai/cordis-plugin-loader"
    "@deepseek-ai/dsh-agent-preset"
    "@deepseek-ai/dsh-attachment-local"
    "@deepseek-ai/dsh-base"
    "@deepseek-ai/dsh-mcp-client"
    "@deepseek-ai/dsh-session-persistence"
    "@deepseek-ai/dsh-session-persistence-jsonl"
  ];
  src = runCommand "dsh-tui-source-${version}" { nativeBuildInputs = [ jq ]; } ''
    mkdir -p $out
    tar -xzf ${tarball} -C $out --strip-components=1
    jq --argjson names '${builtins.toJSON unlistedPeers}' '
      .peerDependencies += ($names | map({ key: ., value: "*" }) | from_entries)
      | .peerDependenciesMeta += ($names | map({ key: ., value: { optional: true } }) | from_entries)' \
      $out/package.json > $out/package.json.runtime
    jq 'del(.devDependencies, .scripts, .bundledDependencies, .peerDependencies, .peerDependenciesMeta)
      | .optionalDependencies |= with_entries(select((.key | startswith("@dsh-")) or .key == "sharp" | not))' \
      $out/package.json.runtime > $out/package.json
    # npm ci empties node_modules; the bundled @dsh-std and @dsh-tui-vendor
    # packages are restored after installation.
    mv $out/node_modules $out/bundled
    cp ${./dsh-tui/package-lock.json} $out/package-lock.json
  '';
  pluginNames = map (p: p.name) plugins;
  npmDepsFetcherVersion = 2;
  npmDepsHash = "sha256-xJNy71464cFL/4DCcd5a7Nx/ZcNS4lelt54ykJM91gk=";
in
assert lib.assertMsg (lib.unique pluginNames == pluginNames) "dsh-tui: duplicate plugin contribution";
buildNpmPackage {
  pname = "dsh-tui";
  inherit version src nodejs;

  patches = lib.concatMap (p: p.patches or [ ]) plugins;
  postPatch = lib.concatMapStrings (p: lib.optionalString ((p.postPatch or "") != "") ''
    echo "dsh-tui: postPatch from ${p.name}"
    ${p.postPatch}
  '') plugins;

  # From the stock source only: the lockfile is the release's, so the stock
  # and fleet builds share one fetch, and no plugin patch or postPatch runs
  # in the fetcher (it has no node, and a patch that stops applying failed
  # the updater's npmDeps rehash instead of the fleet build: issue #58).
  npmDeps = fetchNpmDeps {
    inherit src;
    name = "dsh-tui-${version}-npm-deps";
    fetcherVersion = npmDepsFetcherVersion;
    hash = npmDepsHash;
  };
  # npmConfigHook checks it against the fetched cache's.
  inherit npmDepsFetcherVersion;
  npmFlags = [ "--legacy-peer-deps" "--ignore-scripts" ];
  dontNpmBuild = true;

  postInstall = ''
    pkg=$out/lib/node_modules/@deepseek-harness-tui/dsh-tui
    cp -r bundled/. $pkg/node_modules/
    cp package.json.runtime $pkg/package.json
    # Its launchers bootstrap and self-update a mutable profile; the profile
    # here is managed, so home/dsh.nix supplies `dst` instead.
    rm -r $out/bin
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    export DSH_TUI_TYPES=$out/lib/node_modules/@deepseek-harness-tui/dsh-tui/lib/types
    export HOME=$(mktemp -d)
    node --test ${./dsh-tui/test/stock.test.mjs}
  '' + lib.concatMapStrings (p: lib.optionalString ((p.installCheck or "") != "") ''
    echo "dsh-tui: installCheck from ${p.name}"
    (export HOME=$(mktemp -d); ${p.installCheck})
  '') plugins + ''
    runHook postInstallCheck
  '';

  passthru = {
    inherit plugins;
    typesDir = "lib/node_modules/@deepseek-harness-tui/dsh-tui/lib/types";
    packageDir = "lib/node_modules/@deepseek-harness-tui/dsh-tui";
  };

  meta = {
    description = "Terminal user interface for DeepSeek Harness";
    homepage = "https://github.com/ccch1mneyyy/dsh-TUI";
    changelog = "https://github.com/ccch1mneyyy/dsh-TUI/releases/tag/v${version}";
    license = lib.licenses.mit;
  };
}
