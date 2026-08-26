import z from "@deepseek-ai/schemastery";
//#region src/onboarding.ts
const name = "openllm-onboarding";
const inject = ["subprocess"];
/** Compiled fallback origin, also the safe default when a config value is rejected. */
const DEFAULT_ORIGIN = "https://www.openllm.sh";
const Config = z.object({
	autoInstall: z.string().default("prompt"),
	cloudOrigin: z.string().default(DEFAULT_ORIGIN)
});
const CLI = "openllm";
const DAEMON = "openllmd";
const ORIGIN_ENV = "OPENLLM_CLOUD_ORIGIN";
/**
* Validate + normalize an installer origin before it is ever interpolated into
* the `curl … | bash` command. Mirrors OpenLLM's own update-origin rules
* (`docs/proposals/native-api-key-onboarding.md` §13.2): allow HTTPS, or HTTP
* only for a loopback host; reject embedded credentials, query, fragment, any
* path, and anything `URL` cannot parse (which excludes CR/LF and shell
* metacharacters). A rejected value falls back to the compiled default rather
* than executing an attacker-influenced string. Returns a bare scheme://host[:port].
*/
function safeOrigin(raw) {
	let url;
	try {
		url = new URL(raw);
	} catch {
		return DEFAULT_ORIGIN;
	}
	const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]";
	return (url.protocol === "https:" || url.protocol === "http:" && loopback) && url.username === "" && url.password === "" && url.search === "" && url.hash === "" && (url.pathname === "" || url.pathname === "/") ? url.origin : DEFAULT_ORIGIN;
}
async function apply(ctx, config) {
	const log = ctx.logger(name);
	const safe = {
		...config,
		cloudOrigin: safeOrigin(config.cloudOrigin)
	};
	const [cliPresent, daemonPresent] = await Promise.all([probe(ctx, CLI), probe(ctx, DAEMON)]);
	if (cliPresent && daemonPresent) return;
	const state = {
		cliPresent,
		daemonPresent
	};
	const commands = ctx.get("commands");
	if (commands) {
		const dispose = commands.register({
			name: "openllm-setup",
			description: "Install the OpenLLM CLI + daemon for this harness",
			handler: async () => ({
				kind: "success",
				text: await runSetup(ctx, safe, state)
			})
		});
		ctx.effect(() => dispose);
	}
	log.info(guidanceText(safe, {
		...state,
		hasCommand: Boolean(commands)
	}));
	if (safe.autoInstall === "prompt") promptInstall(ctx, safe, state).catch(() => {});
}
/**
* Interactive install offer, used only when a `userQuestions` provider is
* present. Non-blocking by contract (never awaited by `apply`). On "Install" it
* runs the same installer as `/openllm-setup` and logs the result.
*/
async function promptInstall(ctx, config, state) {
	const questions = ctx.get("userQuestions");
	if (!questions) return;
	const controller = new AbortController();
	const disposeAbort = ctx.effect(() => () => controller.abort());
	try {
		if (!((await questions.ask({
			questions: [{
				id: "openllm-install",
				header: "OpenLLM",
				question: "OpenLLM isn't installed. Install the CLI + daemon now?",
				detail: `Runs  curl -fsSL ${config.cloudOrigin}/install | bash`,
				options: [{
					label: "Install",
					description: "Download and run the OpenLLM installer"
				}, {
					label: "Not now",
					description: "Skip — run /openllm-setup later"
				}]
			}],
			signal: controller.signal
		})).answers.find((a) => a.id === "openllm-install")?.selected ?? []).includes("Install")) return;
		ctx.logger(name).info(await runSetup(ctx, config, state));
	} finally {
		disposeAbort();
	}
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
/**
* Run (or, for `autoInstall: never`, describe) the binary install. Returns UI
* text. Credential setup is deferred to OpenLLM's native `openllm start`.
*/
async function runSetup(ctx, config, state) {
	const log = ctx.logger(name);
	const needsBinaries = !state.cliPresent || !state.daemonPresent;
	if (config.autoInstall === "never" || !needsBinaries) return guidanceText(config, {
		...state,
		hasCommand: true
	});
	const command = `curl -fsSL ${config.cloudOrigin}/install | bash`;
	log.info(`running OpenLLM installer: ${command}`);
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
		env: { [ORIGIN_ENV]: config.cloudOrigin }
	}).done;
	if (outcome.exitCode !== 0) {
		log.error(`OpenLLM installer exited with code ${String(outcome.exitCode)}`);
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
		"OpenLLM CLI + daemon installed.",
		"Open a new shell (or `source` your rc) so `openllm` is on PATH.",
		"",
		...nextStep()
	].join("\n");
}
/** The install guidance block, tailored to what's missing. */
function guidanceText(config, state) {
	const lines = ["OpenLLM setup for DeepSeek Harness:"];
	if (!state.cliPresent || !state.daemonPresent) lines.push("", "1. Install the OpenLLM CLI + daemon:", `     curl -fsSL ${config.cloudOrigin}/install | bash`, config.autoInstall === "prompt" && state.hasCommand ? "   …or run /openllm-setup in a session to do this for you." : "");
	lines.push("", ...nextStep(), "", "Verify:  openllm doctor  •  openllm --version");
	return lines.filter((l) => l !== void 0).join("\n");
}
/**
* The credential step — entirely OpenLLM's own. `openllm start` guides sign-in +
* key acquisition and starts the daemon that serves dsh's local gateway. dsh
* itself needs no key or origin, so there is nothing to paste or export here.
*/
function nextStep() {
	return [
		"2. Start OpenLLM and finish sign-in + key setup (the daemon serves dsh):",
		"     openllm start",
		"",
		"dsh routes through the local daemon gateway (127.0.0.1:8787) — no key or",
		"origin is configured in dsh; the daemon uses ~/.openllm/.env. Keep it running."
	];
}
//#endregion
export { Config, apply, inject, name };
