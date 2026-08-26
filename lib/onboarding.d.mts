import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/onboarding.d.ts
declare const name = "openllm-onboarding";
declare const inject: string[];
interface Config {
  /** `prompt` — `/openllm-setup` runs the installer. `never` — guidance only. */
  autoInstall: "prompt" | "never";
  /** Origin the installer fetches OpenLLM from (self-hosted / preview). */
  cloudOrigin: string;
}
declare const Config: z<Config>;
declare function apply(ctx: Context, config: Config): Promise<void>;
//#endregion
export { Config, apply, inject, name };