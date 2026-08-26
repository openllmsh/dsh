/**
 * @openllmsh/dsh — install bridge.
 *
 * A DeepSeek Harness (Cordis) host plugin that, when the profile LOADS (not at
 * `dsh plugin add` time — that only installs the bundle), checks whether the
 * OpenLLM CLI (`openllm`) + daemon (`openllmd`) are present. If either is
 * missing it: logs guidance, registers an `/openllm-setup` command, and — in an
 * interactive UI (a `userQuestions` provider is present) — pops a non-blocking
 * "Install now?" prompt. All install paths are consent-gated.
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

/** Compiled fallback origin, also the safe default when a config value is rejected. */
const DEFAULT_ORIGIN = "https://www.openllm.sh";

export const Config: z<Config> = z.object({
  autoInstall: z.string().default("prompt") as unknown as z<Config["autoInstall"]>,
  cloudOrigin: z.string().default(DEFAULT_ORIGIN),
});

const CLI = "openllm";
const DAEMON = "openllmd";
const ORIGIN_ENV = "OPENLLM_CLOUD_ORIGIN";

interface BinaryState {
  cliPresent: boolean;
  daemonPresent: boolean;
}

/**
 * Validate + normalize an installer origin before it is ever interpolated into
 * the `curl … | bash` command. Mirrors OpenLLM's own update-origin rules
 * (`docs/proposals/native-api-key-onboarding.md` §13.2): allow HTTPS, or HTTP
 * only for a loopback host; reject embedded credentials, query, fragment, any
 * path, and anything `URL` cannot parse (which excludes CR/LF and shell
 * metacharacters). A rejected value falls back to the compiled default rather
 * than executing an attacker-influenced string. Returns a bare scheme://host[:port].
 */
function safeOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return DEFAULT_ORIGIN;
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]";
  const allowed =
    (url.protocol === "https:" || (url.protocol === "http:" && loopback)) &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === "" &&
    (url.pathname === "" || url.pathname === "/");
  return allowed ? url.origin : DEFAULT_ORIGIN;
}

export async function apply(ctx: Context, config: Config): Promise<void> {
  const log = ctx.logger(name);

  // Validate + normalize the installer origin ONCE, before it can reach any
  // shell command, and thread the safe value through everything below.
  const safe: Config = { ...config, cloudOrigin: safeOrigin(config.cloudOrigin) };

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
        text: await runSetup(ctx, safe, state),
      }),
    });
    ctx.effect(() => dispose);
  }

  // Print guidance now — works in every surface, including headless / ACP.
  // NOTE: cordis inverts log verbosity (ERROR=0, INFO=1, WARN=2, DEBUG=3) and
  // the default visible level is 1, so `warn`/`debug` are hidden by default.
  // Human-facing guidance MUST go through `info` (or `error`) to be seen.
  log.info(guidanceText(safe, { ...state, hasCommand: Boolean(commands) }));

  // In an interactive UI, additionally offer a real "Install now?" prompt. Fire
  // it WITHOUT awaiting: the human may take a while, and Loader settlement waits
  // on apply()'s returned promise, so awaiting would hang harness startup.
  // Headless / ACP have no questions provider, so this no-ops there — the info
  // guidance + command above remain the surface.
  if (safe.autoInstall === "prompt") {
    void promptInstall(ctx, safe, state).catch(() => {
      // No provider, aborted, or declined — the guidance + /openllm-setup stand.
    });
  }
}

/**
 * Interactive install offer, used only when a `userQuestions` provider is
 * present. Non-blocking by contract (never awaited by `apply`). On "Install" it
 * runs the same installer as `/openllm-setup` and logs the result.
 */
async function promptInstall(
  ctx: Context,
  config: Config,
  state: BinaryState,
): Promise<void> {
  const questions = ctx.get("userQuestions");
  if (!questions) return; // headless / ACP — nothing to prompt on.

  const controller = new AbortController();
  const disposeAbort = ctx.effect(() => () => controller.abort());
  try {
    const answer = await questions.ask({
      questions: [
        {
          id: "openllm-install",
          header: "OpenLLM",
          question: "OpenLLM isn't installed. Install the CLI + daemon now?",
          detail: `Runs  curl -fsSL ${config.cloudOrigin}/install | bash`,
          options: [
            { label: "Install", description: "Download and run the OpenLLM installer" },
            { label: "Not now", description: "Skip — run /openllm-setup later" },
          ],
        },
      ],
      signal: controller.signal,
    });
    const chosen = answer.answers.find((a) => a.id === "openllm-install")?.selected ?? [];
    if (!chosen.includes("Install")) return; // declined.
    ctx.logger(name).info(await runSetup(ctx, config, state));
  } finally {
    disposeAbort();
  }
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
    log.error(`OpenLLM installer exited with code ${String(outcome.exitCode)}`);
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
