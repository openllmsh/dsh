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
  <img alt="platforms" src="https://img.shields.io/badge/platforms-darwin%20%C2%B7%20linux-lightgrey.svg">
</p>

---

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`)
bundle that points the harness at the [OpenLLM](https://openllm.sh) gateway and
hands it OpenLLM's MCP tools. It is a **pure-config Cordis patch layer** —
installed from the dsh side, no runtime code — and it does two things:

- **LLM router** — adds an `openllm` provider to dsh's in-box `llm-pi-ai`
  adapter (`openai-completions`) pointed at the daemon's **local-first gateway**
  (`http://127.0.0.1:8787/v1`) and makes it the default model. No adapter code,
  and **no API key**: that loopback surface has no auth gate; the daemon fetches
  signed plans with its own `~/.openllm/.env` credentials and forwards upstream.
- **MCP** — registers the `openllm mcp` stdio server (`openllm`,
  `claude-context`, `supermemory` tool groups). The `openllm` binary resolves
  `~/.openllm/.env` itself, so it too needs nothing from dsh.

dsh holds **no key and no origin** — it just talks to `127.0.0.1:8787`, so the
only thing it requires is that **`openllmd` is running**. Installing OpenLLM is a
prerequisite (below) — the installer starts the daemon for you; this bundle does
not install, prompt for, or onboard it. Runs on the host DeepSeek Harness — the
services it patches
(`@deepseek-ai/dsh-llm-pi-ai`, `@deepseek-ai/dsh-mcp-client`) ship in
`@deepseek-ai/dsh-base`.

## Prerequisite — install OpenLLM

Do this **once** — dsh routes to the local OpenLLM daemon, and the installer sets
it up and starts it for you (macOS / Linux):

```sh
curl -fsSL https://www.openllm.sh/install | bash
```

> This is **OpenLLM's own official installer** (canonical source:
> <https://openllm.sh/install>); it digest-verifies the binaries it downloads. If
> your policy requires it, fetch and read the script before piping it to a shell.
> This bundle only documents the prerequisite — it never runs it.

There is nothing else to run, paste, or export — the installer starts the daemon
and persists your key to `~/.openllm/.env`, and the daemon serves dsh from there.

## Install the bundle

Install into the profile whose surface you actually run. dsh profiles are
separate bundle stacks, so a bundle added to one profile is invisible to the
others — the **browser UI lives only in the `web` profile** (`web` mounts
`dsh-base` + `dsh-web-app`; `headless` mounts `dsh-base` + `dsh-headless`).
The bare `default` profile is `dsh-base` only — no web surface — so adding the
bundle there never reaches the web UI.

```sh
dsh plugin --profile web add github:openllmsh/dsh        # browser UI
dsh plugin --profile headless add github:openllmsh/dsh   # headless / CLI
```

Then **restart the profile**. Distributed from GitHub — no npm package. The built
`lib/` is committed, so the git install loads with no build step (and no pnpm
`allowBuilds` prompt). Pin a release with `github:openllmsh/dsh#<tag>`.

## Self-hosted / custom port

The router base (`http://127.0.0.1:8787/v1`) is fixed in `cordis.patch.yml`. To
route through a self-hosted OpenLLM, point the **daemon** at your origin when you
install it — dsh still just talks to `127.0.0.1:8787`. A custom daemon port
(`OPENLLM_DAEMON_PORT`) means editing the `baseURL` in `cordis.patch.yml` to match.

## Develop

```sh
pnpm install
pnpm build            # tsdown → lib/index.mjs (+ .d.mts) — commit the result
pnpm typecheck        # tsc --noEmit

dsh plugin --profile demo add .          # link this bundle into a scratch profile
dsh --profile demo --dump-config         # inspect the composed plugin tree
```

The bundle's substance is `cordis.patch.yml` (resolved via the `dsh.bundle.patch`
manifest field); `src/index.ts` is an `export {}` placeholder with no runtime API,
matching `@deepseek-ai/dsh-base`.

> `lib/` is committed (GitHub is the only distribution channel), so **rebuild and
> commit it whenever `src/` changes** — a stale `lib/` is what git installs.

> Developer preview — dsh is pre-1.0; pin and re-test against each `dsh` bump.

## License

**MIT** © OpenLLM, INC — see [LICENSE](./LICENSE).
