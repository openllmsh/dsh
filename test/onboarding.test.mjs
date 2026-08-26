/**
 * E2E contract tests for the @openllmsh/dsh install bridge.
 *
 * These drive the SHIPPED artifact (`lib/onboarding.mjs`, rebuilt by `pretest`)
 * through its public surface — `apply(ctx, config)` and the `/openllm-setup`
 * command it registers — using fake `ctx` seams. The subprocess boundary is
 * stubbed, so nothing runs the real installer, spawns curl/bash, or hits the
 * network.
 *
 * The plugin handles no credentials and reads no environment or files (dsh
 * reaches OpenLLM through the daemon's local gateway on 127.0.0.1:8787, and the
 * MCP subprocess resolves ~/.openllm/.env itself), so these tests need no HOME
 * or env isolation — they only assert probe/guidance/install behavior.
 *
 * Run with `pnpm test` (which builds first) or `node --test "test/**\/*.test.mjs"`.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Config, apply, inject, name } from "../lib/onboarding.mjs";

const DEFAULT_ORIGIN = "https://www.openllm.sh";

/** Fully-specified config (apply receives an already-parsed config in dsh). */
function config(overrides = {}) {
  return { autoInstall: "prompt", cloudOrigin: DEFAULT_ORIGIN, ...overrides };
}

/**
 * Build a fake Cordis `ctx`. `present` lists executables that resolve on PATH;
 * `hasCommands` toggles the optional commands service (absent = headless/ACP);
 * `exitCode` is the stubbed installer result. Every seam records its calls.
 */
function makeCtx({ present = [], hasCommands = true, exitCode = 0 } = {}) {
  const calls = { warn: [], info: [], spawns: [], registered: [], effects: [], resolved: [] };
  const commands = {
    register(def) {
      calls.registered.push(def);
      return () => calls.effects.push("disposed");
    },
  };
  const ctx = {
    logger() {
      return { warn: (m) => calls.warn.push(m), info: (m) => calls.info.push(m) };
    },
    subprocess: {
      async resolveExecutable(command) {
        calls.resolved.push(command);
        if (present.includes(command)) return `/usr/local/bin/${command}`;
        throw new Error(`not found: ${command}`);
      },
      spawn(spec) {
        calls.spawns.push(spec);
        return { done: Promise.resolve({ exitCode }) };
      },
    },
    get(service) {
      return service === "commands" && hasCommands ? commands : undefined;
    },
    effect(fn) {
      calls.effects.push(fn);
    },
  };
  return { ctx, calls };
}

/** Invoke the one registered command's handler and return its text. */
async function invokeSetup(calls) {
  assert.equal(calls.registered.length, 1, "expected /openllm-setup to be registered");
  assert.equal(calls.registered[0].name, "openllm-setup");
  const result = await calls.registered[0].handler({});
  assert.equal(result.kind, "success");
  return result.text;
}

describe("module surface", () => {
  test("exports the expected plugin identity", () => {
    assert.equal(name, "openllm-onboarding");
    assert.deepEqual(inject, ["subprocess"]);
  });

  test("Config applies the documented defaults (no installDaemon knob)", () => {
    assert.deepEqual(Config({}), { autoInstall: "prompt", cloudOrigin: DEFAULT_ORIGIN });
  });
});

describe("apply — probe + guidance", () => {
  test("stays fully silent when CLI and daemon are present", async () => {
    const { ctx, calls } = makeCtx({ present: ["openllm", "openllmd"] });
    await apply(ctx, config());
    assert.equal(calls.warn.length, 0, "no guidance when set up");
    assert.equal(calls.registered.length, 0, "no command when set up");
    assert.equal(calls.spawns.length, 0);
  });

  test("always probes BOTH binaries — the daemon is required", async () => {
    const { ctx, calls } = makeCtx({ present: ["openllm", "openllmd"] });
    await apply(ctx, config());
    assert.deepEqual([...calls.resolved].sort(), ["openllm", "openllmd"]);
  });

  test("a present CLI but missing daemon still prompts to install", async () => {
    const { ctx, calls } = makeCtx({ present: ["openllm"] });
    await apply(ctx, config());
    assert.equal(calls.warn.length, 1, "daemon absence must not be silent");
    assert.equal(calls.registered.length, 1);
  });

  test("missing binaries → registers command + prints native guidance", async () => {
    const { ctx, calls } = makeCtx({ present: [] });
    await apply(ctx, config());

    assert.equal(calls.registered.length, 1);
    assert.equal(calls.warn.length, 1);
    const text = calls.warn[0];

    assert.match(text, /curl -fsSL https:\/\/www\.openllm\.sh\/install \| bash/);
    assert.match(text, /openllm start/);
    assert.match(text, /127\.0\.0\.1:8787/); // the local gateway is the routing story
    assert.match(text, /Verify:\s+openllm doctor/);
    assert.match(text, /\/openllm-setup/); // prompt hint present when commands exist

    // No credential handling of any kind survives.
    assert.doesNotMatch(text, /\/keys/);
    assert.doesNotMatch(text, /sk-llm/);
    assert.doesNotMatch(text, /openllm login/);
    assert.doesNotMatch(text, /OPENLLM_API_KEY/);
    assert.doesNotMatch(text, /export /);
  });

  test("headless (no commands service) still warns, registers nothing, omits the /openllm-setup hint", async () => {
    const { ctx, calls } = makeCtx({ present: [], hasCommands: false });
    await apply(ctx, config());
    assert.equal(calls.registered.length, 0);
    assert.equal(calls.warn.length, 1);
    assert.doesNotMatch(calls.warn[0], /\/openllm-setup/);
  });

  test("custom cloudOrigin flows into the printed install command", async () => {
    const { ctx, calls } = makeCtx({ present: [] });
    await apply(ctx, config({ cloudOrigin: "https://dev.openllm.sh" }));
    assert.match(calls.warn[0], /curl -fsSL https:\/\/dev\.openllm\.sh\/install \| bash/);
  });
});

describe("/openllm-setup — install bridge", () => {
  test("installs the CLI + daemon with an origin-only env and nothing else", async () => {
    const { ctx, calls } = makeCtx({ present: [] });
    await apply(ctx, config());
    const text = await invokeSetup(calls);

    assert.equal(calls.spawns.length, 1, "installer spawned once");
    const spec = calls.spawns[0];

    assert.deepEqual(spec.argv, [
      "bash",
      "-lc",
      "curl -fsSL https://www.openllm.sh/install | bash",
    ]);
    assert.equal(spec.stdio.stdin, "ignore");

    // The spawn env carries ONLY the origin — no secret, no surprise vars.
    assert.deepEqual(Object.keys(spec.env), ["OPENLLM_CLOUD_ORIGIN"]);
    assert.equal(spec.env.OPENLLM_CLOUD_ORIGIN, DEFAULT_ORIGIN);

    assert.match(text, /installed/);
    assert.match(text, /openllm start/);
  });

  test("custom origin reaches both the install argv and its env", async () => {
    const origin = "https://dev.openllm.sh";
    const { ctx, calls } = makeCtx({ present: [] });
    await apply(ctx, config({ cloudOrigin: origin }));
    await invokeSetup(calls);
    const spec = calls.spawns[0];
    assert.deepEqual(spec.argv, ["bash", "-lc", `curl -fsSL ${origin}/install | bash`]);
    assert.equal(spec.env.OPENLLM_CLOUD_ORIGIN, origin);
  });

  test("autoInstall:never describes instead of installing", async () => {
    const { ctx, calls } = makeCtx({ present: [] });
    await apply(ctx, config({ autoInstall: "never" }));
    const text = await invokeSetup(calls);
    assert.equal(calls.spawns.length, 0, "must not spawn when autoInstall is never");
    assert.match(text, /curl -fsSL https:\/\/www\.openllm\.sh\/install \| bash/);
    // The prompt hint is suppressed for `never`, even at apply time.
    assert.doesNotMatch(calls.warn[0], /\/openllm-setup/);
  });

  test("a failed installer surfaces the exit code and falls back to guidance", async () => {
    const { ctx, calls } = makeCtx({ present: [], exitCode: 1 });
    await apply(ctx, config());
    const text = await invokeSetup(calls);
    assert.match(text, /exited with code 1/);
    assert.match(text, /curl -fsSL https:\/\/www\.openllm\.sh\/install \| bash/);
    assert.ok(calls.warn.some((m) => /exited with code 1/.test(m)), "the exit code is logged");
  });
});
