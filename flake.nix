{
  description = "dsh-web-search-exa: Exa web_search provider for DeepSeek Harness";

  inputs = {
    # Same nixpkgs and nix-dsh revisions as jakehemmerle/nix-config @ 6a7e613,
    # so dsh is the fleet's 0.2.1-alpha.2 build.
    nixpkgs.url = "github:NixOS/nixpkgs/7fc6f2c20af09cdcaf48b92ec3121860139ec668";
    # nix-config's nixpkgs-tools pin: beads 1.3.0.
    nixpkgs-tools.url = "github:NixOS/nixpkgs/b6c8664de9b6cc07fe5666a29f91884ba81197c4";
    nix-dsh = {
      url = "github:jakehemmerle/nix-dsh/f0ca0d745df8cbe99bad91d59153dbd690ae6660";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, nixpkgs-tools, nix-dsh }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" "x86_64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system nixpkgs.legacyPackages.${system});
      manifest = builtins.fromJSON (builtins.readFile ./package.json);
      env = system: pkgs: rec {
        nodejs = pkgs.nodejs_24;
        dsh = pkgs.callPackage "${nix-dsh}/package.nix" { };
        dshRoot = "${dsh}/lib/node_modules/@deepseek-ai/dsh";
        dshTui = pkgs.callPackage ./nix/dsh-tui.nix { };
        dshTuiDir = "${dshTui}/lib/node_modules/@deepseek-harness-tui/dsh-tui";
        beads = nixpkgs-tools.legacyPackages.${system}.beads;
        browsers = pkgs.playwright-driver.browsers;
        src = pkgs.lib.fileset.toSource {
          root = ./.;
          fileset = pkgs.lib.fileset.unions [ ./lib ./test ./package.json ./package-lock.json ];
        };
        nodeModules = pkgs.importNpmLock.buildNodeModules { npmRoot = src; inherit nodejs; };
        package = pkgs.stdenvNoCC.mkDerivation {
          pname = manifest.name;
          inherit (manifest) version;
          src = pkgs.lib.fileset.toSource { root = ./.; fileset = pkgs.lib.fileset.unions [ ./lib ./package.json ]; };
          dontConfigure = true;
          dontBuild = true;
          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -r lib package.json $out/
            runHook postInstall
          '';
          meta = {
            description = "Exa web_search provider for DeepSeek Harness";
            license = pkgs.lib.licenses.mit;
          };
        };
      };
    in
    {
      packages = forAllSystems (system: pkgs: let e = env system pkgs; in {
        default = e.package;
        dsh = e.dsh;
        dsh-tui = e.dshTui;
      });

      # Fast suites (unit properties + host contract) inside the sandbox.
      checks = forAllSystems (system: pkgs: let e = env system pkgs; in {
        package = e.package;
        fast = pkgs.runCommand "dsh-web-search-exa-fast-tests" { nativeBuildInputs = [ e.nodejs ]; } ''
          cp -r ${e.src} src && chmod -R u+w src && cd src
          ln -s ${e.nodeModules}/node_modules node_modules
          export HOME=$TMPDIR DSH_ROOT=${e.dshRoot} NUM_RUNS=${"$"}{NUM_RUNS:-1000}
          node --test --test-concurrency=4 'test/unit/*.test.mjs' 'test/contract/*.test.mjs' 'test/meta/*.test.mjs'
          touch $out
        '';
      });

      # Real-client suites (dsh web via Playwright, dsh-TUI in a private tmux):
      #   nix run .#e2e [-- web|tui|all]   (run from the repository root)
      apps = forAllSystems (system: pkgs: let e = env system pkgs;
        e2e = pkgs.writeShellApplication {
          name = "dsh-web-search-exa-e2e";
          runtimeInputs = [ e.nodejs pkgs.tmux pkgs.coreutils pkgs.zstd ];
          text = ''
            if [ ! -f package.json ] || ! grep -q '"name": "dsh-web-search-exa"' package.json; then
              echo "run nix run .#e2e from the dsh-web-search-exa checkout" >&2; exit 2
            fi
            [ -e node_modules ] || ln -s ${e.nodeModules}/node_modules node_modules
            export DSH_BIN=${e.dsh}/bin/dsh DSH_ROOT=${e.dshRoot} DSH_TUI_DIR="${"$"}{DSH_TUI_DIR:-${e.dshTuiDir}}"
            export EXA_PLUGIN_ENTRY="${"$"}{EXA_PLUGIN_ENTRY:-${e.package}/lib/index.js}"
            export PLAYWRIGHT_BROWSERS_PATH=${e.browsers} PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
            exec node test/e2e/run.mjs "$@"
          '';
        };
      in { e2e = { type = "app"; program = "${e2e}/bin/dsh-web-search-exa-e2e"; }; });

      devShells = forAllSystems (system: pkgs: let e = env system pkgs; in {
        default = pkgs.mkShell {
          packages = [ e.nodejs pkgs.tmux pkgs.zstd e.beads e.dsh ];
          DSH_BIN = "${e.dsh}/bin/dsh";
          DSH_ROOT = e.dshRoot;
          DSH_TUI_DIR = e.dshTuiDir;
          PLAYWRIGHT_BROWSERS_PATH = e.browsers;
          PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
        };
      });
    };
}
