import { defineConfig } from "tsdown";

// Builds the single host plugin entry to `lib/onboarding.js` (+ .d.ts), matching
// package.json `main`/`types`. The `cordis.patch.yml` ships as-is (not bundled).
export default defineConfig({
  entry: ["src/onboarding.ts"],
  format: ["esm"],
  dts: true,
  outDir: "lib",
  clean: true,
  // dsh services + cordis are peers — never bundle them.
  external: [/^@deepseek-ai\//],
});
