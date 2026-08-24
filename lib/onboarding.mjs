import z from "@deepseek-ai/schemastery";
//#region src/onboarding.ts
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
const CLI_ONLY_INSTALL = "https://raw.githubusercontent.com/openllmsh/cli/main/install.sh";
async function apply(ctx, config) {
	const log = ctx.logger(name);
	const [cliPresent, daemonPresent] = await Promise.all([probe(ctx, CLI), config.installDaemon ? probe(ctx, DAEMON) : Promise.resolve(true)]);
	const keyPresent = Boolean(process.env[KEY_ENV]);
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
