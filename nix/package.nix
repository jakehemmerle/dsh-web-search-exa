{ lib, stdenvNoCC, nodejs, importNpmLock, dsh, dsh-tui ? null }:

# The installable plugin root (docs/dsh-plugin-contract.md in nix-config):
# $out/lib/index.js is the entry a profile row names, and $out/package.json +
# $out/cordis.patch.yml make $out a dsh bundle (`dsh plugin add link:$out`).
# Plain dependency-free ESM, so nothing is compiled. The check phase runs the
# complete fast suite (unit properties + host contract + bundle composition)
# against the given dsh; dsh-tui is unused (this plugin patches nothing in it).
let
  manifest = lib.importJSON ../package.json;
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [ ../lib ../test ../package.json ../package-lock.json ../cordis.patch.yml ];
  };
  nodeModules = importNpmLock.buildNodeModules { npmRoot = src; inherit nodejs; };
  dshRoot = "${dsh}/lib/node_modules/@deepseek-ai/dsh";
in
assert lib.assertMsg (dsh.version == manifest.peerDependencies."@deepseek-ai/dsh-web")
  "dsh-web-search-exa ${manifest.version} is qualified for DSH ${manifest.peerDependencies."@deepseek-ai/dsh-web"}, not ${dsh.version}";
stdenvNoCC.mkDerivation {
  pname = manifest.name;
  inherit (manifest) version;
  inherit src;

  nativeBuildInputs = [ nodejs ];
  dontConfigure = true;
  dontBuild = true;

  doCheck = true;
  checkPhase = ''
    runHook preCheck
    ln -s ${nodeModules}/node_modules node_modules
    export HOME=$(mktemp -d) DSH_ROOT=${dshRoot} DSH_BIN=${dsh}/bin/dsh NUM_RUNS=''${NUM_RUNS:-1000}
    node --test --test-concurrency=4 test/unit/*.test.mjs test/contract/*.test.mjs
    rm node_modules
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp -r lib package.json cordis.patch.yml $out/
    runHook postInstall
  '';

  passthru = { inherit dsh; };

  meta = {
    description = "Exa web_search provider for DeepSeek Harness";
    homepage = "https://github.com/jakehemmerle/dsh-web-search-exa";
    license = lib.licenses.mit;
  };
}
