/**
 * Real-cordis integration harness for the @openllmsh/dsh install bridge.
 *
 * The node:test suite (test/onboarding.test.mjs) uses a FAKE logger, so it
 * cannot catch cordis's level-filtering (which once hid the guidance: cordis
 * inverts verbosity — ERROR=0, INFO=1, WARN=2, DEBUG=3 — and the default visible
 * level is 1, so `warn` is dropped). This harness loads the built plugin into a
 * REAL `@deepseek-ai/cordis` Context with a REAL print exporter at the default
 * level, and probes the REAL `$PATH`, so it reproduces exactly what dsh shows on
 * a machine — the loop we were pushing to GitHub to test.
 *
 * Behavior is environment-driven and correct either way:
 *   - openllm + openllmd both on PATH  → the plugin must stay SILENT.
 *   - either missing                   → the guidance MUST print, at a VISIBLE
 *                                        level (info/error, never warn).
 *
 * Exit 0 = contract holds; exit 1 = a real regression (e.g. guidance went back
 * to `warn` and vanished). Run in Ubuntu via the repo Dockerfile, or locally.
 */

import assert from "node:assert/strict";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

import { Context } from "@deepseek-ai/cordis";

import { apply } from "../../lib/onboarding.mjs";

/** Real PATH executable resolution — mirrors dsh's subprocess-local. Throws if absent. */
function resolveExecutableName(command) {
  if (command.includes("/")) {
    accessSync(command, constants.X_OK);
    return command;
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(dir, command);
    try {
      if (statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK);
        return candidate;
      }
    } catch {
      // next PATH entry
    }
  }
  throw new Error(`not found on PATH: ${command}`);
}

const onPath = (command) => {
  try {
    resolveExecutableName(command);
    return true;
  } catch {
    return false;
  }
};

// ── Real cordis logger + a print exporter at the DEFAULT level ───────────────
const root = new Context();
const captured = [];
root.logger.exporter({
  colors: 0,
  export: (message) => {
    const text = message.args.map(String).join(" ");
    captured.push({ type: message.type, name: message.name, text });
    process.stdout.write(`[${message.type.toUpperCase()}] [${message.name}] ${text}\n`);
  },
});

// ── Fidelity self-check: prove this harness reproduces dsh's level filter ─────
const selfcheck = root.logger("harness-selfcheck");
selfcheck.info("SELFCHECK-INFO-VISIBLE");
selfcheck.warn("SELFCHECK-WARN-HIDDEN");
const seen = (needle) => captured.some((c) => c.text.includes(needle));
assert.equal(seen("SELFCHECK-INFO-VISIBLE"), true, "harness fidelity: info must be visible");
assert.equal(
  seen("SELFCHECK-WARN-HIDDEN"),
  false,
  "harness fidelity: warn must be hidden at the default level (this is the bug class we guard)",
);

// ── Minimal ctx: REAL logger (real level filter) + fake dsh service seams ─────
const commandsRegistered = [];
const ctx = {
  logger: (name) => root.logger(name),
  effect: (fn) => {
    const cleanup = fn();
    return () => {
      if (typeof cleanup === "function") cleanup();
    };
  },
  subprocess: {
    async resolveExecutable(command) {
      return resolveExecutableName(command);
    },
    spawn() {
      throw new Error("harness: installer spawn is not expected in the guidance path");
    },
  },
  // Headless surface: commands available, but NO userQuestions provider — the
  // exact shape of a plain SSH box, where only the printed guidance is visible.
  get(service) {
    if (service === "commands") {
      return {
        register(def) {
          commandsRegistered.push(def);
          return () => {};
        },
      };
    }
    return undefined;
  },
};

const before = captured.length;
await apply(ctx, { autoInstall: "prompt", cloudOrigin: "https://www.openllm.sh" });
// Give the (non-awaited, no-provider) prompt a tick to no-op.
await new Promise((r) => setTimeout(r, 20));
const pluginLogs = captured.slice(before).filter((c) => c.name === "openllm-onboarding");

const cliThere = onPath("openllm");
const daemonThere = onPath("openllmd");

console.log("\n──────── result ────────");
console.log(`openllm on PATH:  ${cliThere}`);
console.log(`openllmd on PATH: ${daemonThere}`);

if (cliThere && daemonThere) {
  assert.equal(pluginLogs.length, 0, "both binaries present → the plugin must stay silent");
  console.log("✓ both binaries present → plugin correctly SILENT");
} else {
  const guidance = pluginLogs.find((c) => c.text.includes("Install the OpenLLM CLI"));
  assert.ok(guidance, "openllm missing → guidance MUST be printed (and visible)");
  assert.equal(guidance.type, "info", "guidance must be at a VISIBLE level (info), not warn");
  assert.match(guidance.text, /curl -fsSL https:\/\/www\.openllm\.sh\/install \| bash/);
  assert.match(guidance.text, /openllm start/);
  assert.equal(commandsRegistered.length, 1, "/openllm-setup must be registered");
  assert.equal(commandsRegistered[0].name, "openllm-setup");
  console.log("✓ openllm missing → guidance printed at a VISIBLE level, /openllm-setup registered");
}

console.log("\n✓ integration harness passed");
