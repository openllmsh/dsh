/**
 * @openllmsh/dsh — DeepSeek Harness bundle that routes dsh through OpenLLM.
 *
 * The package's substance is `cordis.patch.yml`, declared by the
 * `dsh.bundle.patch` manifest field and resolved by the profile composer through
 * that field; this module carries no runtime API (same shape as
 * `@deepseek-ai/dsh-base`). The bundle:
 *   1. adds an `openllm` provider to dsh's in-box `llm-pi-ai` adapter, pointed at
 *      the daemon's local-first gateway (`127.0.0.1:8787`), and makes it default;
 *   2. registers the `openllm mcp` stdio server.
 *
 * Installing OpenLLM is a documented prerequisite (`curl … /install | bash`, which
 * starts the daemon itself) — this bundle deliberately does NOT install, prompt
 * for, or onboard OpenLLM. See the README.
 *
 * @module @openllmsh/dsh
 */

export {};
