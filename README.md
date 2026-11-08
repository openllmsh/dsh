<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="./assets/openllm-light.svg">
    <img alt="OpenLLM" src="./assets/openllm.svg" width="300">
  </picture>
</p>

<p align="center"><b>@openllmsh/dsh</b> - route DeepSeek Harness through OpenLLM.</p>

<p align="center">
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="dsh-plugin" src="https://img.shields.io/badge/dsh-plugin-informational.svg">
  <img alt="platforms" src="https://img.shields.io/badge/platforms-darwin%20%C2%B7%20linux-lightgrey.svg">
</p>

---

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`)
bundle that points the harness at the [OpenLLM](https://www.openllm.sh) gateway and
hands it OpenLLM's MCP tools. It is a **pure-config Cordis patch layer**,
installed from the dsh side, with no runtime code. It does two things:

- **LLM router** - adds an `openllm` provider to dsh's in-box `llm-pi-ai`
  adapter (`openai-completions`) pointed at the daemon's **local-first gateway**
  (`http://127.0.0.1:8787/v1`) and makes it the default model. No adapter code,
  and **no API key in dsh**: the daemon authenticates with the saved login from
  `openllm login` and forwards upstream. Image input is enabled on the route;
  thinking levels map to OpenLLM `reasoning_effort`
  (`none|minimal|low|medium|high|xhigh|max`).
- **MCP** - registers the OpenLLM MCP stdio server. The command resolves to
  `$HOME/.openllm/bin/openllm` (installer binary path) with args `['mcp']`, so
  Desktop/GUI launches that do not inherit a shell `PATH` still find it.

dsh holds **no key and no origin** - it talks to `127.0.0.1:8787` with a
placeholder bearer that the daemon runs as the saved login. Installing OpenLLM
and signing in are prerequisites (below). Runs on the host DeepSeek Harness;
the services it patches (`@deepseek-ai/dsh-llm-pi-ai`, `@deepseek-ai/dsh-mcp-client`)
ship in `@deepseek-ai/dsh-base`.

OpenLLM routes your API keys, local vendors and local models through one
format-agnostic endpoint. See the [OpenLLM documentation](https://docs.openllm.sh).

## Prerequisite - install OpenLLM and sign in

Do this **once** (macOS / Linux):

```sh
curl -fsSL https://www.openllm.sh/install | bash
openllm login
```

> This is **OpenLLM's own official installer** (canonical source:
> <https://www.openllm.sh/install>); it digest-verifies the binaries it downloads. If
> your policy requires it, fetch and read the script before piping it to a shell.
> This bundle only documents the prerequisite - it never runs it.

The installer places the binary at `~/.openllm/bin/openllm` and can start the
daemon. `openllm login` saves credentials the daemon uses for loopback calls.
There is nothing else to paste or export into dsh.

## Install the bundle

Install into the profile whose surface you actually run. dsh profiles are
separate bundle stacks, so a bundle added to one profile is invisible to the
others - the **browser UI lives only in the `web` profile** (`web` mounts
`dsh-base` + `dsh-web-app`; `headless` mounts `dsh-base` + `dsh-headless`).
The bare `default` profile is `dsh-base` only - no web surface - so adding the
bundle there never reaches the web UI.

Browser UI (`web` profile):

```sh
dsh plugin --profile web add @openllmsh/dsh
```

Headless / CLI (`headless` profile):

```sh
dsh plugin --profile headless add @openllmsh/dsh
```

Then **restart the profile**. Prefer the npm package. The GitHub spec remains an
alternative (`dsh plugin --profile web add github:openllmsh/dsh`, pin with
`#<tag>`). The built `lib/` is committed, so a git install loads with no build
step (and no pnpm `allowBuilds` prompt).

## Images and reasoning

- **Images** - the `openllm` route declares `defaultInput: [text, image]`, so
  attached images are accepted when the resolved model supports vision.
- **Reasoning** - dsh thinking levels map to OpenLLM `reasoning_effort` values
  (`off` → `none`, then `minimal` through `max`). The route default is `medium`.

## MCP binary path and startup race

The MCP entry uses `$HOME/.openllm/bin/openllm` (via Cordis `!!js`), not a bare
`openllm` on `PATH`, so GUI hosts find the installer binary. If `HOME` is unset,
it falls back to `openllm` on `PATH`.

The first MCP tool call can fail while the OpenLLM MCP server or daemon is still
starting. `failOnStartupError` stays false and reconnect uses a short initial
delay; wait a moment and retry the call - it reconnects automatically.

## Self-hosted / custom port

The router base (`http://127.0.0.1:8787/v1`) is fixed in `cordis.patch.yml`. To
route through a self-hosted OpenLLM, point the **daemon** at your origin when you
install it - dsh still just talks to `127.0.0.1:8787`. A custom daemon port
(`OPENLLM_DAEMON_PORT`) means editing the `baseURL` in `cordis.patch.yml` to match.

## Develop

```sh
pnpm install
pnpm build            # tsdown → lib/index.mjs (+ .d.mts) - commit the result
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run

dsh plugin --profile demo add .          # link this bundle into a scratch profile
dsh --profile demo --dump-config         # inspect the composed plugin tree
```

The bundle's substance is `cordis.patch.yml` (resolved via the `dsh.bundle.patch`
manifest field); `src/index.ts` is an `export {}` placeholder with no runtime API,
matching `@deepseek-ai/dsh-base`.

> `lib/` is committed (needed for git installs), so **rebuild and commit it
> whenever `src/` changes** - a stale `lib/` is what git installs.

> Developer preview - dsh is pre-1.0; pin and re-test against each `dsh` bump.

## License

**MIT** © OpenLLM, INC - see [LICENSE](./LICENSE).
