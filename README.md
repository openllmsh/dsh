<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="./assets/openllm-light.svg">
    <img alt="OpenLLM" src="./assets/openllm.svg" width="300">
  </picture>
</p>

<p align="center"><b>@openllmsh/dsh</b> — route DeepSeek Harness through OpenLLM.</p>

<p align="center">
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="dsh-plugin" src="https://img.shields.io/badge/dsh-plugin-informational.svg">
  <img alt="targets" src="https://img.shields.io/badge/onboarding-darwin%20%C2%B7%20linux-lightgrey.svg">
</p>

---

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`)
bundle that points the harness at the [OpenLLM](https://openllm.sh) gateway and
hands it OpenLLM's MCP tools — then makes first-run setup self-service. It is a
**Cordis patch layer**, installed from the dsh side; it is not part of OpenLLM's
own client setup.

- **LLM router** — adds an `openllm` provider to dsh's in-box `llm-pi-ai`
  adapter (`openai-completions`) pointed at the daemon's **local-first gateway**
  (`http://127.0.0.1:8787/v1`) and makes it the default model. No adapter code —
  pure config, and **no API key**: that loopback surface has no auth gate; the
  daemon fetches signed plans with its own `~/.openllm/.env` credentials and
  forwards upstream.
- **MCP** — registers the `openllm mcp` stdio server (`openllm`,
  `claude-context`, `supermemory` tool groups). The `openllm` binary resolves
  `~/.openllm/.env` itself, so it too needs nothing from dsh.
- **Install bridge** — when the profile **loads**, if `openllm` or `openllmd` is
  missing, it prints guidance, registers an `/openllm-setup` command, and — in an
  interactive UI — pops an "Install now?" prompt; any of them installs both with
  your consent. That is all it does — it handles no credentials (no key, no
  origin, no `~/.openllm/.env` parsing). Sign-in + key setup is OpenLLM's own, via
  `openllm start`. Note: `dsh plugin add` only *installs* this bundle — the check
  runs when you next **start/restart the profile**.

Runs on the host DeepSeek Harness — the services it patches
(`@deepseek-ai/dsh-llm-pi-ai`, `@deepseek-ai/dsh-mcp-client`) ship in
`@deepseek-ai/dsh-base`.

## Install

```sh
dsh plugin --profile default add github:openllmsh/dsh
```

Distributed from GitHub — no npm package. The built `lib/` is committed, so the
git install loads with no build step (and no pnpm `allowBuilds` prompt). Pin a
release with `github:openllmsh/dsh#<tag>`.

**Restart the profile** (this is when the check runs — `add` alone won't trigger
it). If `openllm`/`openllmd` isn't installed yet, take the "Install now?" prompt,
run `/openllm-setup`, or follow the printed hint:

```sh
# 1. Install the OpenLLM CLI + daemon (macOS / Linux). A keyless install
#    succeeds — it never starts an unpaired daemon.
curl -fsSL https://www.openllm.sh/install | bash

# 2. Sign in, get a key, and start the daemon that serves dsh:
openllm start
#    (interactive: prints the sign-in URL, then reads + persists your key)

# 3. Verify
openllm doctor && openllm --version
```

dsh holds **no key and no origin**. Its LLM traffic goes to the daemon's
local-first gateway (`127.0.0.1:8787`), which the daemon serves from its own
`~/.openllm/.env`; the MCP subprocess resolves that file itself. So the only
requirement dsh adds is that **`openllmd` is running** — which `openllm start`
takes care of. There is nothing to paste or export into your shell.

## Configuration

Set on the `openllm-onboarding` row in `cordis.patch.yml`:

| Key | Default | Meaning |
| --- | --- | --- |
| `autoInstall` | `prompt` | `prompt` = `/openllm-setup` runs the installer; `never` = guidance only |
| `cloudOrigin` | `https://www.openllm.sh` | origin the **installer** fetches OpenLLM from (self-hosted / preview) — it does not affect routing |

The router base (`http://127.0.0.1:8787/v1`) is fixed in `cordis.patch.yml`; it
carries no `apiKeyEnv` because the loopback gateway ignores auth. To route
through a self-hosted OpenLLM, point that daemon at your origin at install time
(`cloudOrigin`) — dsh still just talks to `127.0.0.1:8787`. A custom daemon port
(`OPENLLM_DAEMON_PORT`) means editing the `baseURL` to match.

## Develop

```sh
pnpm install
pnpm build            # tsdown → lib/onboarding.mjs (+ .d.mts) — commit the result
pnpm typecheck        # tsc --noEmit

dsh plugin --profile demo add .          # link this bundle into a scratch profile
dsh --profile demo --dump-config         # inspect the composed plugin tree
```

### Test

```sh
pnpm test               # unit suite (fake ctx) — fast, no cordis
pnpm test:integration   # real @deepseek-ai/cordis logger + real $PATH probe (host)
pnpm test:docker        # the same, inside a throwaway container (openllm absent)
```

`pnpm test:docker` does **not** build an image. It builds `lib/` on the host,
then mounts the repo into an existing image and runs `node` there — a clean box
where `openllm` isn't installed, i.e. the real missing-binary scenario — so you
can see what dsh actually shows **without pushing to GitHub to test it**. Default
image is `node:22-slim` (instant); point it at your own with
`DSH_TEST_IMAGE=ubuntu:24.04 pnpm test:docker` (a nodeless image installs node
once for that run).

The integration harness (`test/integration/harness.mjs`) loads the built plugin
into a real cordis Context with a real print exporter — which is what catches
log-**visibility** bugs the fake-logger unit tests can't: cordis inverts verbosity
(`ERROR=0, INFO=1, WARN=2, DEBUG=3`) and hides `warn` at the default level, so
guidance must be emitted at `info`/`error`. It also self-checks that a `warn` is
hidden while an `info` shows, so the harness can't silently stop reproducing dsh.

> `lib/` is committed (GitHub is the only distribution channel), so **rebuild and
> commit it whenever `src/` changes** — a stale `lib/` is what git installs.

> Developer preview — dsh is pre-1.0; pin and re-test against each `dsh` bump.

## License

**MIT** © OpenLLM, INC — see [LICENSE](./LICENSE).
