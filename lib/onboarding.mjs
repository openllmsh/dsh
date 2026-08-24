import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import z from "@deepseek-ai/schemastery";
//#region src/onboarding.ts
/**
* @openllmsh/dsh — onboarding plugin.
*
* A DeepSeek Harness (Cordis) host plugin that, at launch, checks whether the
* OpenLLM CLI (`openllm`) + daemon (`openllmd`) and an `sk-llm-…` key are
* present, and if not either installs them (consent-gated, via the `/openllm-setup`
* slash command) or prints step-by-step guidance. It also hydrates
* `process.env` from the shared `~/.openllm/.env` (written by the OpenLLM
* installer/daemon) so a key/origin that lives only in that file reaches both
* this detection and dsh's pi-ai router. The router + MCP wiring itself is pure
* config in `cordis.patch.yml`; this file only handles first-run setup.
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
const name = "openllm-onboarding";
const inject = ["subprocess"];
const Config = z.object({
	autoInstall: z.string().default("prompt"),
	installDaemon: z.boolean().default(true),
	cloudOrigin: z.string().default("https://openllm.sh")
});
const CLI = "openllm";
const DAEMON = "openllmd";
const KEY_ENV = "OPENLLM_API_KEY";
const ORIGIN_ENV = "OPENLLM_CLOUD_ORIGIN";
const BASE_ENV = "OPENLLM_API_BASE";
const CLI_ONLY_INSTALL = "https://raw.githubusercontent.com/openllmsh/cli/main/install.sh";
/** The shared env file the OpenLLM installer/daemon write (`~/.openllm/.env`). */
const sharedEnvFile = () => {
	const home = process.env.HOME && process.env.HOME.length > 0 ? process.env.HOME : homedir();
	return join(home, ".openllm", ".env");
};
/**
* Parse a `KEY=VALUE` env file (comments + blank lines ignored, surrounding
* quotes stripped) — mirrors the OpenLLM CLI's own reader so both agree on the
* shared file's shape.
*/
const parseEnvFile = (path) => {
	const out = {};
	let text;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return out;
	}
	for (const line of text.split("\n")) {
		const t = line.trim();
		if (t.length === 0 || t.startsWith("#")) continue;
		const eq = t.indexOf("=");
		if (eq <= 0) continue;
		out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
	}
	return out;
};
/**
* Hydrate `process.env` from `~/.openllm/.env` for any OpenLLM keys not already
* set, matching the CLI's precedence (process env wins, the file fills gaps).
* This is why the LLM router works when the installer wrote the key only to the
* file: dsh's pi-ai adapter resolves `apiKeyEnv: OPENLLM_API_KEY` from the
* environment (lazily, at request time), so the hydrated value reaches it, and
* `OPENLLM_API_BASE` (derived from `OPENLLM_CLOUD_ORIGIN`) reaches the router's
* `baseURL`. Returns whether a usable key is now present.
*/
function hydrateSharedEnv() {
	const file = parseEnvFile(sharedEnvFile());
	if (!process.env[KEY_ENV] && file[KEY_ENV]) process.env[KEY_ENV] = file[KEY_ENV];
	if (!process.env[BASE_ENV]) {
		const origin = process.env[ORIGIN_ENV] ?? file[BASE_ENV] ?? file[ORIGIN_ENV];
		if (origin) process.env[BASE_ENV] = origin.replace(/\/+$/, "");
	}
	return Boolean(process.env[KEY_ENV]);
}
async function apply(ctx, config) {
	const log = ctx.logger(name);
	const keyPresent = hydrateSharedEnv();
	const [cliPresent, daemonPresent] = await Promise.all([probe(ctx, CLI), config.installDaemon ? probe(ctx, DAEMON) : Promise.resolve(true)]);
	if (cliPresent && daemonPresent && keyPresent) return;
	const commands = ctx.get("commands");
	if (commands) {
		const dispose = commands.register({
			name: "openllm-setup",
			description: "Install or configure the OpenLLM CLI + daemon for this harness",
			handler: async () => ({
				kind: "success",
				text: await runSetup(ctx, config, {
					cliPresent,
					daemonPresent,
					keyPresent
				})
			})
		});
		ctx.effect(() => dispose);
	}
	log.warn(guidanceText(config, {
		cliPresent,
		daemonPresent,
		keyPresent,
		hasCommand: Boolean(commands)
	}));
}
/** True when `command` resolves on PATH. */
async function probe(ctx, command) {
	try {
		await ctx.subprocess.resolveExecutable(command);
		return true;
	} catch {
		return false;
	}
}
/** Run (or, for `autoInstall: never`, describe) the setup. Returns UI text. */
async function runSetup(ctx, config, state) {
	const log = ctx.logger(name);
	const needsBinaries = !state.cliPresent || config.installDaemon && !state.daemonPresent;
	if (config.autoInstall === "never" || !needsBinaries) return guidanceText(config, {
		...state,
		hasCommand: true
	});
	const command = config.installDaemon ? `curl -fsSL ${config.cloudOrigin}/install | bash` : `curl -fsSL ${CLI_ONLY_INSTALL} | bash`;
	log.info(`running OpenLLM installer: ${command}`);
	const env = { OPENLLM_CLOUD_ORIGIN: config.cloudOrigin };
	if (process.env[KEY_ENV]) env[KEY_ENV] = process.env[KEY_ENV];
	const outcome = await ctx.subprocess.spawn({
		argv: [
			"bash",
			"-lc",
			command
		],
		cwd: process.cwd(),
		stdio: {
			stdin: "ignore",
			stdout: { maxBytes: 1e6 },
			stderr: { maxBytes: 1e6 }
		},
		graceMs: 18e4,
		env
	}).done;
	if (outcome.exitCode !== 0) {
		log.warn(`OpenLLM installer exited with code ${String(outcome.exitCode)}`);
		return [
			`OpenLLM installer exited with code ${String(outcome.exitCode)}.`,
			"",
			guidanceText(config, {
				...state,
				hasCommand: true
			})
		].join("\n");
	}
	return [
		"OpenLLM CLI" + (config.installDaemon ? " + daemon" : "") + " installed.",
		"Open a new shell (or `source` your rc) so `openllm` is on PATH, then restart",
		"this dsh profile so the OpenLLM MCP server activates.",
		"",
		...process.env[KEY_ENV] ? [] : keyGuidance(config)
	].join("\n");
}
/** The full guidance block, tailored to what's missing. */
function guidanceText(config, state) {
	const lines = ["OpenLLM setup for DeepSeek Harness:"];
	if (!state.cliPresent || config.installDaemon && !state.daemonPresent) lines.push("", "1. Install the OpenLLM CLI" + (config.installDaemon ? " + daemon" : "") + ":", config.installDaemon ? `     curl -fsSL ${config.cloudOrigin}/install | bash` : `     curl -fsSL ${CLI_ONLY_INSTALL} | bash`, config.autoInstall === "prompt" && state.hasCommand ? "   …or run /openllm-setup in a session to do this for you." : "");
	if (!state.keyPresent) lines.push("", ...keyGuidance(config));
	lines.push("", "Verify:  openllmd status  •  openllm doctor  •  openllm --version");
	return lines.filter((l) => l !== void 0).join("\n");
}
function keyGuidance(config) {
	return [
		`${config.installDaemon ? "2" : "1"}. Mint an API key in the browser — there is no \`openllm login\`:`,
		`     ${config.cloudOrigin}/keys   (sign up, unlock the vault, create a key)`,
		`   Then either re-run the installer with the key so ~/.openllm/.env is`,
		`   written, or export it for this shell:`,
		`     export ${KEY_ENV}=sk-llm-…`
	];
}
//#endregion
export { Config, apply, inject, name };
