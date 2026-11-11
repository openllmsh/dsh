<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/openllmsh/dsh/main/assets/openllm-light.svg">
    <img alt="OpenLLM" src="https://raw.githubusercontent.com/openllmsh/dsh/main/assets/openllm.svg" width="300">
  </picture>
</p>

<p align="center"><b>@openllmsh/dsh</b> — route DeepSeek Harness through OpenLLM.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@openllmsh/dsh"><img alt="npm" src="https://img.shields.io/npm/v/@openllmsh/dsh.svg"></a>
  <a href="https://www.npmjs.com/package/@openllmsh/dsh?activeTab=versions"><img alt="npm next" src="https://img.shields.io/npm/v/@openllmsh/dsh/next.svg?label=next"></a>
  <a href="https://github.com/openllmsh/dsh/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="dsh plugin" src="https://img.shields.io/badge/dsh-plugin-blue.svg">
</p>

---

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`)
plugin that runs the harness on OpenLLM models and gives it OpenLLM's MCP tools.
It is a pure-config Cordis patch with no runtime code.

- **OpenLLM as the default model.** Adds an `openllm` provider to dsh's in-box
  `llm-pi-ai` adapter, pointed at the local daemon (`http://127.0.0.1:8787/v1`),
  with the `ultra`, `plus` and `lite` models (`ultra` by default).
- **Images and reasoning.** Image input is on, and dsh thinking levels map to
  OpenLLM `reasoning_effort` (`off` to `none`, then `minimal` through `max`).
- **No key in dsh.** The daemon serves requests with your saved `openllm login`,
  so there is nothing to paste or export.
- **MCP that works from the Desktop app.** The OpenLLM MCP server is started from
  `$HOME/.openllm/bin/openllm`, so GUI launches without your shell `PATH` still
  find it, and a failed first connect retries quickly.

[OpenLLM](https://www.openllm.sh) routes your API keys, local vendors and local
models through one format-agnostic endpoint. See the
[documentation](https://docs.openllm.sh).

## Before you begin

Install OpenLLM with **Full** setup (dsh needs the local daemon, which Minimal
does not run), sign in, and start the daemon. macOS and Linux:

```sh
curl -fsSL https://www.openllm.sh/install | bash
openllm login
openllm start
openllm status
```

On macOS, the [Mac app](https://www.openllm.sh/download/mac) is an alternative.

Agents install with `bash -s -- --non-interactive --full`, which does not start
the daemon. Then run `openllm login --non-interactive`, have the user approve
the link, run the printed `openllm login --resume <id>`, and run `openllm start`.

## Install

Add the plugin to the profile you run. Profiles are separate, so a plugin in one
is not visible in another.

```sh
dsh plugin --profile web add @openllmsh/dsh        # browser UI
dsh plugin --profile headless add @openllmsh/dsh   # headless / CLI
dsh plugin --profile web add @openllmsh/dsh@next   # the latest prerelease
```

Restart the profile afterwards. Each npm release is published by CI from this
repository with [provenance](https://docs.npmjs.com/generating-provenance-statements).
The same source is tagged here, so `github:openllmsh/dsh#vX.Y.Z` installs the
identical code (`lib/` is committed, so no build step runs).

## What it configures

| Setting | Value |
| --- | --- |
| Provider | `openllm` on `llm-pi-ai`, `openai-completions`, `http://127.0.0.1:8787/v1` |
| Models | `ultra` (default), `plus`, `lite` |
| Input | `text`, `image` |
| Reasoning | default `medium`; `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| Compatibility | `supportsDeveloperRole: false` (OpenLLM takes the system prompt as `system`) |
| MCP server | `openllm`, stdio, `$HOME/.openllm/bin/openllm mcp` (falls back to `openllm` on `PATH`) |
| MCP startup | `failOnStartupError: false`, reconnect after 100 ms |

All of it lives in [`cordis.patch.yml`](./cordis.patch.yml).

## Common problems

| Symptom | Fix |
| --- | --- |
| `auth_error` mentioning `openllm login` | Sign the daemon in with `openllm login`. |
| Connection refused on `127.0.0.1:8787` | Run `openllm start`, then `openllm status`. |
| First MCP tool call fails right after startup | Wait a moment and retry. The client reconnects on its own. |
| Daemon on a custom port (`OPENLLM_DAEMON_PORT`) | Change `baseURL` in `cordis.patch.yml` to match. |

## Develop

```sh
pnpm install
pnpm build && pnpm typecheck && pnpm test
npm pack && node scripts/smoke-npm.mjs openllmsh-dsh-*.tgz   # tarball smoke test

dsh plugin --profile demo add .     # link into a scratch profile
dsh --profile demo --dump-config    # inspect the composed tree
```

`lib/` is committed for git installs, so rebuild and commit it when `src/`
changes. dsh is pre-1.0; re-test against each `dsh` release.

Releases: bump `version`, tag `vX.Y.Z`, and publish a GitHub release.
`.github/workflows/npm-publish.yml` tests, smoke-tests and publishes with npm
trusted publishing (stable to `latest`, prereleases to `next`).

## License

**MIT** © OpenLLM, INC. See [`LICENSE`](./LICENSE).
