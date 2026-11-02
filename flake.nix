{
  description = "dsh-web-search-exa: Exa web_search provider for DeepSeek Harness";

  inputs = {
    # Same nixpkgs and nix-dsh revisions as jakehemmerle/nix-config @ e580478,
    # so dsh is the fleet's 0.2.1-rc.2 build (nix-dsh 09c130d).
    nixpkgs.url = "github:NixOS/nixpkgs/6f06d204d8f2d8761d9da78778745974a3216381";
    # nix-config's nixpkgs-tools pin: beads 1.3.0.
    nixpkgs-tools.url = "github:NixOS/nixpkgs/b6c8664de9b6cc07fe5666a29f91884ba81197c4";
    nix-dsh = {
      url = "github:jakehemmerle/nix-dsh/09c130deea81128953bd3f18c89ce956740b81f8";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, nixpkgs-tools, nix-dsh }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" "x86_64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system nixpkgs.legacyPackages.${system});
      env = system: pkgs: rec {
        nodejs = pkgs.nodejs_24;
        dsh = pkgs.callPackage "${nix-dsh}/package.nix" { };
        dshRoot = "${dsh}/lib/node_modules/@deepseek-ai/dsh";
        # The fleet's stock dsh-TUI 0.17.0 (recipe copied from nix-config).
        dshTui = pkgs.callPackage ./nix/dsh-tui.nix { };
        dshTuiDir = "${dshTui}/lib/node_modules/@deepseek-harness-tui/dsh-tui";
        beads = nixpkgs-tools.legacyPackages.${system}.beads;
        browsers = pkgs.playwright-driver.browsers;
        # The checkout's dev dependencies (fast-check, playwright) for the e2e.
        nodeModules = pkgs.importNpmLock.buildNodeModules {
          npmRoot = pkgs.lib.fileset.toSource { root = ./.; fileset = pkgs.lib.fileset.unions [ ./package.json ./package-lock.json ]; };
          inherit nodejs;
        };
        # nix/package.nix's check phase runs the fast suite against this dsh.
        package = pkgs.callPackage ./nix/package.nix { inherit dsh nodejs; dsh-tui = dshTui; };
      };
    in
    {
      packages = forAllSystems (system: pkgs: let e = env system pkgs; in {
        default = e.package;
        dsh = e.dsh;
        dsh-tui = e.dshTui;
      });

      checks = forAllSystems (system: pkgs: let e = env system pkgs; in {
        package = e.package;
        dsh-tui = e.dshTui;
      });

      # Real-client suites (dsh web via Playwright, dsh-TUI in a private tmux),
      # against the built package (PLUGIN_ROOT) and the pinned dsh/dsh-TUI:
      #   nix run .#e2e [-- headless|web|tui|all]   (from the repository root)
      apps = forAllSystems (system: pkgs: let e = env system pkgs;
        e2e = pkgs.writeShellApplication {
          name = "dsh-web-search-exa-e2e";
          runtimeInputs = [ e.nodejs pkgs.pnpm pkgs.tmux pkgs.coreutils pkgs.zstd ];
          text = ''
            if [ ! -f package.json ] || ! grep -q '"name": "dsh-web-search-exa"' package.json; then
              echo "run nix run .#e2e from the dsh-web-search-exa checkout" >&2; exit 2
            fi
            [ -e node_modules ] || ln -s ${e.nodeModules}/node_modules node_modules
            export DSH_BIN="''${DSH_BIN:-${e.dsh}/bin/dsh}" DSH_ROOT=${e.dshRoot}
            export DSH_TUI_DIR="''${DSH_TUI_DIR:-${e.dshTuiDir}}"
            export PLUGIN_ROOT="''${PLUGIN_ROOT:-${e.package}}"
            export PLAYWRIGHT_BROWSERS_PATH=${e.browsers} PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
            exec nix/e2e "$@"
          '';
        };
      in { e2e = { type = "app"; program = "${e2e}/bin/dsh-web-search-exa-e2e"; }; });

      devShells = forAllSystems (system: pkgs: let e = env system pkgs; in {
        default = pkgs.mkShell {
          packages = [ e.nodejs pkgs.pnpm pkgs.tmux pkgs.zstd e.beads e.dsh ];
          DSH_BIN = "${e.dsh}/bin/dsh";
          DSH_ROOT = e.dshRoot;
          DSH_TUI_DIR = e.dshTuiDir;
          PLAYWRIGHT_BROWSERS_PATH = e.browsers;
          PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
        };
      });
    };
}
