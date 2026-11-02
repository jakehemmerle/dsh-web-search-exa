# dsh-web-search-exa

An [Exa](https://exa.ai) search provider for DeepSeek Harness. It registers the provider `exa`
on the `@deepseek-ai/dsh-web` seam, so the `web_search` tool sends its queries to Exa's
`/search` API and returns the results as sources. It works the same from dsh web, dsh-TUI and
headless runs. `web_fetch` is unchanged. The plugin has no UI of its own.

## Install

The package is a dsh bundle. Use the profile you run (`web`, `headless`, …):

```sh
dsh plugin --profile web add github:jakehemmerle/dsh-web-search-exa#v0.3.0-rc.1
export EXA_API_KEY=…   # in the environment that launches dsh
```

The bundle's [`cordis.patch.yml`](cordis.patch.yml) pins the web seam's `searchProvider` to
`exa` and adds the `web-search-exa` row. Restart dsh web after installing.

This release is qualified against DSH `0.2.1-rc.2`; its peer pin is exact, so other DSH
versions need `dsh plugin allow-version` or a newer release.

## Configuration

Override the row in your profile's own `cordis.patch.yml`. A patch replaces the whole row
config, so restate any field you keep.

| Field | Default | Meaning |
|---|---|---|
| `apiKeyEnv` | `EXA_API_KEY` | Key name: looked up in dsh's credential store, then (after `apiKeyFile`) in the environment |
| `apiKeyFile` | (unset) | File holding the key (raw or dotenv), read on every search, so a rotated key needs no restart; it wins over the environment |
| `apiKey` | (unset) | Literal key, used before any other source (avoid) |
| `baseURL` | `https://api.exa.ai` | Exa API origin |
| `type` | `auto` | Exa search type |
| `highlightChars` | `600` | Highlight length per result |
| `timeoutMs` | `30000` | Request timeout |

```yaml
- id: web-search-exa
  config:
    apiKeyFile: /run/secrets/exa
```

## Development

`nix flake check` runs the fast suites against the pinned dsh; `nix run .#e2e` runs the real
dsh web (Playwright), dsh-TUI (private tmux) and headless suites against a local mock Exa.
See [SPEC.md](SPEC.md), [TESTING.md](TESTING.md) and [RELEASING.md](RELEASING.md).

License: MIT.
