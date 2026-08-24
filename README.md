<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="./assets/openllm-light.svg">
    <img alt="OpenLLM" src="./assets/openllm.svg" width="300">
  </picture>
</p>

<p align="center"><b>@openllm/dsh</b> — route DeepSeek Harness through OpenLLM.</p>

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
  adapter (`openai-completions` → OpenLLM `/v1/chat/completions`) and points the
  default model at it. No adapter code — pure config.
- **MCP** — registers the `openllm mcp` stdio server (`openllm`,
  `claude-context`, `supermemory` tool groups).
- **Onboarding** — on launch, if the `openllm` CLI/daemon or an API key is
  missing, it registers an `/openllm-setup` command and prints guidance; running
  it installs the CLI (+ daemon) with your consent.

Runs on the host DeepSeek Harness — the services it patches
(`@deepseek-ai/dsh-llm-pi-ai`, `@deepseek-ai/dsh-mcp-client`) ship in
`@deepseek-ai/dsh-base`.

## Install

```sh
dsh plugin --profile default add @openllm/dsh
# or straight from git:
dsh plugin --profile default add github:openllmsh/dsh
```

Restart the profile. If OpenLLM isn't set up yet, follow the printed guidance
(or run `/openllm-setup` in a session):

```sh
# 1. Install the OpenLLM CLI + daemon (macOS / Linux)
curl -fsSL https://openllm.sh/install | bash

# 2. Mint an API key in the browser — there is no `openllm login`:
#    https://openllm.sh/keys  (sign up, unlock the vault, create a key)
export OPENLLM_API_KEY=sk-llm-…
#    …or pass it to the installer so ~/.openllm/.env is written:
#    curl -fsSL https://openllm.sh/install | OPENLLM_API_KEY='sk-llm-…' bash

# 3. Verify
openllmd status && openllm doctor && openllm --version
```

The daemon is only needed for OpenLLM's subscription providers or the local
`127.0.0.1:8787` gateway; plain cloud BYOK + MCP need just the CLI binary and a
key (`installDaemon: false`).

## Configuration

Set on the `openllm-onboarding` row in `cordis.patch.yml`:

| Key | Default | Meaning |
| --- | --- | --- |
| `autoInstall` | `prompt` | `prompt` = `/openllm-setup` runs the installer; `never` = guidance only |
| `installDaemon` | `true` | also install / expect `openllmd` |
| `cloudOrigin` | `https://openllm.sh` | gateway origin (self-hosted / preview) |

Point the router at a self-hosted gateway with `OPENLLM_API_BASE`
(e.g. `http://127.0.0.1:8787`). The key comes from `OPENLLM_API_KEY`
(env · dsh credentials · `~/.openllm/.env`) and is never written into YAML.

## Develop

```sh
pnpm install
pnpm build            # tsdown → lib/onboarding.mjs (+ .d.mts)
pnpm typecheck        # tsc --noEmit

dsh plugin --profile demo add .          # link this bundle into a scratch profile
dsh --profile demo --dump-config         # inspect the composed plugin tree
```

> Developer preview — dsh is pre-1.0; pin and re-test against each `dsh` bump.

## License

**MIT** © OpenLLM, INC — see [LICENSE](./LICENSE).
