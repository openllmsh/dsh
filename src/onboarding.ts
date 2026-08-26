/**
 * @openllmsh/dsh — install bridge.
 *
 * A DeepSeek Harness (Cordis) host plugin that, at launch, checks whether the
 * OpenLLM CLI (`openllm`) + daemon (`openllmd`) are present, and if not either
 * installs them (consent-gated, via the `/openllm-setup` slash command) or
 * prints a short install hint.
 *
 * That is ALL it does. It handles no credentials — no key, no origin, no
 * `~/.openllm/.env` parsing. dsh reaches OpenLLM two ways, and neither needs
 * anything from this plugin:
 *   - the MCP server (`openllm mcp`) is a subprocess of the `openllm` binary,
 *     which resolves `~/.openllm/.env` itself;
 *   - the LLM router (`cordis.patch.yml`) points at the daemon's local-first
 *     gateway on `127.0.0.1:8787`, a loopback surface with no auth gate — the
 *     daemon fetches signed plans with its own `~/.openllm/.env` credentials and
 *     forwards upstream.
 *
 * So the daemon must be running (that is what `openllm start` sets up), but the
 * key + origin live only with the daemon, never in dsh.
 *
 * Design constraints:
 *   - Named exports only; NO default export (a default export drops `inject`).
 *   - NEVER await the installer inside `apply()` — Loader settlement +
 *     `assertEntriesActivated` wait on the returned promise, so a hung install
 *     would hang the whole harness. `apply` does cheap probes only; the install
 *     runs from the `/openllm-setup` command handler (explicit user intent).
 *   - Headless / ACP have no user-questions provider and their stdout is
 *     load-bearing (assistant text / JSON-RPC), so guidance goes to the logger,
 *     never to stdout, and we never throw out of `apply`.
 */

import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
// `ctx.subprocess` / `ctx.commands` shapes come from the local ambient shim
// (src/dsh-augment.d.ts); the real services are provided by the running dsh.

export const name = "openllm-onboarding";

// Only `subprocess` is required to run the probes. `commands` is used when
// present (Web) but is optional, so it is not injected — we `ctx.get` it.
export const inject = ["subprocess"];

export interface Config {
  /** `prompt` — `/openllm-setup` runs the installer. `never` — guidance only. */
  autoInstall: "prompt" | "never";
  /** Origin the installer fetches OpenLLM from (self-hosted / preview). */
  cloudOrigin: string;
}

export const Config: z<Config> = z.object({
  autoInstall: z.string().default("prompt") as unknown as z<Config["autoInstall"]>,
  cloudOrigin: z.string().default("https://www.openllm.sh"),
});

const CLI = "openllm";
const DAEMON = "openllmd";
const ORIGIN_ENV = "OPENLLM_CLOUD_ORIGIN";

interface BinaryState {
  cliPresent: boolean;
  daemonPresent: boolean;
}

export async function apply(ctx: Context, config: Config): Promise<void> {
  const log = ctx.logger(name);

  // Cheap probes only — never await the installer here. The daemon is required
  // (it serves dsh's local gateway), so both binaries are always probed.
  const [cliPresent, daemonPresent] = await Promise.all([
    probe(ctx, CLI),
    probe(ctx, DAEMON),
  ]);

  if (cliPresent && daemonPresent) return; // both present — stay silent.

  const state: BinaryState = { cliPresent, daemonPresent };

  // Register `/openllm-setup` when the commands service is available (Web).
  const commands = ctx.get("commands");
  if (commands) {
    const dispose = commands.register({
      name: "openllm-setup",
      description: "Install the OpenLLM CLI + daemon for this harness",
      handler: async () => ({
        kind: "success",
        text: await runSetup(ctx, config, state),
      }),
    });
    ctx.effect(() => dispose);
  }

  // Print guidance now — works in every surface, including headless / ACP.
  log.warn(guidanceText(config, { ...state, hasCommand: Boolean(commands) }));
}

/** True when `command` resolves on PATH. */
async function probe(ctx: Context, command: string): Promise<boolean> {
  try {
    await ctx.subprocess.resolveExecutable(command);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run (or, for `autoInstall: never`, describe) the binary install. Returns UI
 * text. Credential setup is deferred to OpenLLM's native `openllm start`.
 */
async function runSetup(
  ctx: Context,
  config: Config,
  state: BinaryState,
): Promise<string> {
  const log = ctx.logger(name);
  const needsBinaries = !state.cliPresent || !state.daemonPresent;

  if (config.autoInstall === "never" || !needsBinaries) {
    return guidanceText(config, { ...state, hasCommand: true });
  }

  const command = `curl -fsSL ${config.cloudOrigin}/install | bash`;
  log.info(`running OpenLLM installer: ${command}`);

  // `bash -lc` because the one-liner is a pipeline; argv is NOT shell-interpreted
  // by the subprocess seam, so we invoke bash explicitly. A keyless install now
  // succeeds — pass only the origin (never a secret), so the installer records
  // the matching `OPENLLM_CLOUD_ORIGIN` for the daemon.
  const handle = ctx.subprocess.spawn({
    argv: ["bash", "-lc", command],
    cwd: process.cwd(),
    stdio: {
      stdin: "ignore",
      stdout: { maxBytes: 1_000_000 },
      stderr: { maxBytes: 1_000_000 },
    },
    graceMs: 180_000,
    env: { [ORIGIN_ENV]: config.cloudOrigin },
  });

  const outcome = await handle.done;
  if (outcome.exitCode !== 0) {
    log.warn(`OpenLLM installer exited with code ${String(outcome.exitCode)}`);
    return [
      `OpenLLM installer exited with code ${String(outcome.exitCode)}.`,
      "",
      guidanceText(config, { ...state, hasCommand: true }),
    ].join("\n");
  }

  return [
    "OpenLLM CLI + daemon installed.",
    "Open a new shell (or `source` your rc) so `openllm` is on PATH.",
    "",
    ...nextStep(),
  ].join("\n");
}

/** The install guidance block, tailored to what's missing. */
function guidanceText(
  config: Config,
  state: BinaryState & { hasCommand: boolean },
): string {
  const lines: string[] = ["OpenLLM setup for DeepSeek Harness:"];

  if (!state.cliPresent || !state.daemonPresent) {
    lines.push(
      "",
      "1. Install the OpenLLM CLI + daemon:",
      `     curl -fsSL ${config.cloudOrigin}/install | bash`,
      config.autoInstall === "prompt" && state.hasCommand
        ? "   …or run /openllm-setup in a session to do this for you."
        : "",
    );
  }

  lines.push("", ...nextStep(), "", "Verify:  openllm doctor  •  openllm --version");
  return lines.filter((l) => l !== undefined).join("\n");
}

/**
 * The credential step — entirely OpenLLM's own. `openllm start` guides sign-in +
 * key acquisition and starts the daemon that serves dsh's local gateway. dsh
 * itself needs no key or origin, so there is nothing to paste or export here.
 */
function nextStep(): string[] {
  return [
    "2. Start OpenLLM and finish sign-in + key setup (the daemon serves dsh):",
    "     openllm start",
    "",
    "dsh routes through the local daemon gateway (127.0.0.1:8787) — no key or",
    "origin is configured in dsh; the daemon uses ~/.openllm/.env. Keep it running.",
  ];
}
