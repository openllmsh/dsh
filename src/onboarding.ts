/**
 * @openllm/dsh — onboarding plugin.
 *
 * A DeepSeek Harness (Cordis) host plugin that, at launch, checks whether the
 * OpenLLM CLI (`openllm`) + daemon (`openllmd`) and an `sk-llm-…` key are
 * present, and if not either installs them (consent-gated, via the `/openllm-setup`
 * slash command) or prints step-by-step guidance. The router + MCP wiring itself
 * is pure config in `cordis.patch.yml`; this file only handles first-run setup.
 *
 * Design constraints (see docs in the openllm repo,
 * `docs/proposals/deepseek-harness-plugin.md`):
 *   - Named exports only; NO default export (a default export drops `inject`).
 *   - NEVER await the installer inside `apply()` — Loader settlement +
 *     `assertEntriesActivated` wait on the returned promise, so a hung install
 *     would hang the whole harness. `apply` does cheap probes only; the install
 *     runs from the `/openllm-setup` command handler (explicit user intent).
 *   - `scrubbedParentEnv()` strips any env key matching `*KEY*`, so
 *     `OPENLLM_API_KEY` is not inherited by a spawned child — it must be passed
 *     explicitly in `spec.env`.
 *   - Headless / ACP have no user-questions provider and their stdout is
 *     load-bearing (assistant text / JSON-RPC), so guidance goes to the logger,
 *     never to stdout, and we never throw out of `apply`.
 */

import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
// Type-only: pull in the Context augmentations for the services we touch.
import type {} from "@deepseek-ai/dsh-subprocess";
import type {} from "@deepseek-ai/dsh-commands";

export const name = "openllm-onboarding";

// Only `subprocess` is required to run the probes. `commands` is used when
// present (Web) but is optional, so it is not injected — we `ctx.get` it.
export const inject = ["subprocess"];

export interface Config {
  /** `prompt` — `/openllm-setup` runs the installer. `never` — guidance only. */
  autoInstall: "prompt" | "never";
  /** Install the daemon too (needed for subscription providers / local gateway). */
  installDaemon: boolean;
  /** Gateway origin used by the installer and non-prod deployments. */
  cloudOrigin: string;
}

export const Config: z<Config> = z.object({
  autoInstall: z.string().default("prompt") as unknown as z<Config["autoInstall"]>,
  installDaemon: z.boolean().default(true),
  cloudOrigin: z.string().default("https://openllm.sh"),
});

const CLI = "openllm";
const DAEMON = "openllmd";
const KEY_ENV = "OPENLLM_API_KEY";
const CLI_ONLY_INSTALL =
  "https://raw.githubusercontent.com/openllmsh/cli/main/install.sh";

export async function apply(ctx: Context, config: Config): Promise<void> {
  const log = ctx.logger(name);

  // Cheap probes only — never await the installer here.
  const [cliPresent, daemonPresent] = await Promise.all([
    probe(ctx, CLI),
    config.installDaemon ? probe(ctx, DAEMON) : Promise.resolve(true),
  ]);
  const keyPresent = Boolean(process.env[KEY_ENV]);

  if (cliPresent && daemonPresent && keyPresent) return; // fully set up — stay silent.

  // Register `/openllm-setup` when the commands service is available (Web).
  const commands = ctx.get("commands");
  if (commands) {
    const dispose = commands.register({
      name: "openllm-setup",
      description:
        "Install or configure the OpenLLM CLI + daemon for this harness",
      handler: async () => ({
        kind: "success",
        text: await runSetup(ctx, config, { cliPresent, daemonPresent, keyPresent }),
      }),
    });
    ctx.effect(() => dispose);
  }

  // Print guidance now — works in every surface, including headless / ACP.
  log.warn(
    guidanceText(config, { cliPresent, daemonPresent, keyPresent, hasCommand: Boolean(commands) }),
  );
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

/** Run (or, for `autoInstall: never`, describe) the setup. Returns UI text. */
async function runSetup(
  ctx: Context,
  config: Config,
  state: { cliPresent: boolean; daemonPresent: boolean; keyPresent: boolean },
): Promise<string> {
  const log = ctx.logger(name);
  const needsBinaries = !state.cliPresent || (config.installDaemon && !state.daemonPresent);

  if (config.autoInstall === "never" || !needsBinaries) {
    return guidanceText(config, { ...state, hasCommand: true });
  }

  const command = config.installDaemon
    ? `curl -fsSL ${config.cloudOrigin}/install | bash`
    : `curl -fsSL ${CLI_ONLY_INSTALL} | bash`;

  log.info(`running OpenLLM installer: ${command}`);

  // `bash -lc` because the one-liner is a pipeline; argv is NOT shell-interpreted
  // by the subprocess seam, so we invoke bash explicitly. Pass the key + origin
  // in `env` — the scrubbed parent env drops OPENLLM_API_KEY (matches *KEY*).
  const env: NodeJS.ProcessEnv = { OPENLLM_CLOUD_ORIGIN: config.cloudOrigin };
  if (process.env[KEY_ENV]) env[KEY_ENV] = process.env[KEY_ENV];

  const handle = ctx.subprocess.spawn({
    argv: ["bash", "-lc", command],
    cwd: process.cwd(),
    stdio: {
      stdin: "ignore",
      stdout: { maxBytes: 1_000_000 },
      stderr: { maxBytes: 1_000_000 },
    },
    graceMs: 180_000,
    env,
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
    "OpenLLM CLI" + (config.installDaemon ? " + daemon" : "") + " installed.",
    "Open a new shell (or `source` your rc) so `openllm` is on PATH, then restart",
    "this dsh profile so the OpenLLM MCP server activates.",
    "",
    ...(process.env[KEY_ENV] ? [] : keyGuidance(config)),
  ].join("\n");
}

/** The full guidance block, tailored to what's missing. */
function guidanceText(
  config: Config,
  state: { cliPresent: boolean; daemonPresent: boolean; keyPresent: boolean; hasCommand: boolean },
): string {
  const lines: string[] = ["OpenLLM setup for DeepSeek Harness:"];

  if (!state.cliPresent || (config.installDaemon && !state.daemonPresent)) {
    lines.push(
      "",
      "1. Install the OpenLLM CLI" + (config.installDaemon ? " + daemon" : "") + ":",
      config.installDaemon
        ? `     curl -fsSL ${config.cloudOrigin}/install | bash`
        : `     curl -fsSL ${CLI_ONLY_INSTALL} | bash`,
      config.autoInstall === "prompt" && state.hasCommand
        ? "   …or run /openllm-setup in a session to do this for you."
        : "",
    );
  }

  if (!state.keyPresent) lines.push("", ...keyGuidance(config));

  lines.push(
    "",
    "Verify:  openllmd status  •  openllm doctor  •  openllm --version",
  );
  return lines.filter((l) => l !== undefined).join("\n");
}

function keyGuidance(config: Config): string[] {
  const n = config.installDaemon ? "2" : "1";
  return [
    `${n}. Mint an API key in the browser — there is no \`openllm login\`:`,
    `     ${config.cloudOrigin}/keys   (sign up, unlock the vault, create a key)`,
    `   Then either re-run the installer with the key so ~/.openllm/.env is`,
    `   written, or export it for this shell:`,
    `     export ${KEY_ENV}=sk-llm-…`,
  ];
}
