# @openllm/dsh

Route [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`)
through the [OpenLLM](https://openllm.sh) gateway, and give the harness OpenLLM's
MCP tools — plus a first-run onboarding step that installs or walks you through
the OpenLLM CLI + daemon.

This is a **dsh bundle** (a Cordis patch layer). It is not part of OpenLLM's own
client setup — you install it from the dsh side.

## What it does

- **LLM router** — adds an `openllm` provider to dsh's in-box `llm-pi-ai`
  adapter (`api: openai-completions` → OpenLLM `/v1/chat/completions`) and points
  the default model at it. No adapter code — pure config.
- **MCP** — registers the `openllm mcp` stdio server (`openllm`,
  `claude-context`, `supermemory` tool groups).
- **Onboarding** — on launch, if the `openllm` CLI/daemon or an API key is
  missing, it registers a `/openllm-setup` command and prints guidance. Running
  `/openllm-setup` installs the CLI (+ daemon) with your consent.

## Install

```sh
dsh plugin --profile default add @openllm/dsh
# or straight from git:
dsh plugin --profile default add github:openllmsh/dsh
```

Then restart the profile. If OpenLLM isn't set up yet, follow the printed
guidance (or run `/openllm-setup` in a session):

1. **Install the CLI + daemon** (macOS / Linux):
   ```sh
   curl -fsSL https://openllm.sh/install | bash
   ```
2. **Mint an API key** — there is no `openllm login`; keys are created in the
   browser at <https://openllm.sh/keys> (sign up, unlock the vault, create a
   key). Then re-run the installer with the key, or export it:
   ```sh
   curl -fsSL https://openllm.sh/install | OPENLLM_API_KEY='sk-llm-…' bash
   # or, for an already-installed CLI:
   export OPENLLM_API_KEY=sk-llm-…
   ```
3. **Verify:** `openllmd status` · `openllm doctor` · `openllm --version`

The daemon is only required for OpenLLM's subscription providers or the local
`127.0.0.1:8787` gateway. For plain cloud BYOK + MCP, the CLI binary + a key are
enough (`installDaemon: false`).

## Configuration

The bundle's `cordis.patch.yml` accepts (on the `openllm-onboarding` row):

| Key | Default | Meaning |
| --- | --- | --- |
| `autoInstall` | `prompt` | `prompt` = `/openllm-setup` runs the installer; `never` = guidance only |
| `installDaemon` | `true` | also install/expect `openllmd` |
| `cloudOrigin` | `https://openllm.sh` | gateway origin (set for self-hosted / preview) |

Point the router at a self-hosted gateway with `OPENLLM_API_BASE`
(e.g. `http://127.0.0.1:8787`); the key comes from `OPENLLM_API_KEY`
(env / dsh credentials / `~/.openllm/.env`) and is never written into YAML.

## Develop

```sh
pnpm install
pnpm build          # tsdown → lib/onboarding.js (+ .d.ts)
# iterate against a local dsh without publishing:
dsh plugin --profile demo add .
# or overlay the patch directly:
dsh web --patch ./cordis.patch.yml
```

> Developer preview — dsh is pre-1.0; pin and re-test against each `dsh` bump.

## License

MIT
