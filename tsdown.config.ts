import { defineConfig } from "tsdown";

// Builds the bundle's placeholder entry to `lib/index.mjs` (+ .d.mts), matching
// package.json `main`/`types`. The substance is `cordis.patch.yml`, which ships
// as-is (not bundled); this module carries no runtime API.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  outDir: "lib",
  clean: true,
  // dsh services + cordis are peers — never bundle them.
  external: [/^@deepseek-ai\//],
});
