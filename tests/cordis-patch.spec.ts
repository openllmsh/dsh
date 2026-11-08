import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  OPENLLM_REASONING_EFFORTS,
  PI_THINKING_LEVELS,
  PACKAGE_PATH,
  PATCH_PATH,
  readPackageJson,
  readPatch,
  type JsExpr,
} from './helpers/load-patch.ts'

type PatchEntry = {
  id?: string
  name?: string
  config?: Record<string, unknown>
  insert?: PatchEntry[]
}

function asEntries(doc: unknown): PatchEntry[] {
  expect(Array.isArray(doc)).toBe(true)
  return doc as PatchEntry[]
}

function openllmProvider(doc: unknown) {
  const entries = asEntries(doc)
  const llm = entries.find((e) => e.id === 'llm-pi-ai')
  expect(llm?.config).toBeTruthy()
  const providers = llm!.config!.providers as Record<string, Record<string, unknown>>
  expect(providers.openllm).toBeTruthy()
  return providers.openllm
}

function mcpEntry(doc: unknown): PatchEntry {
  const entries = asEntries(doc)
  const insertWrapper = entries.find((e) => Array.isArray(e.insert))
  expect(insertWrapper?.insert?.length).toBeGreaterThan(0)
  const mcp = insertWrapper!.insert!.find((e) => e.id === 'mcp-openllm')
  expect(mcp).toBeTruthy()
  return mcp!
}

describe('@openllmsh/dsh cordis.patch.yml', () => {
  it('parses as a top-level entry list (yaml/js-yaml not in node_modules; subset loader)', () => {
    // Evidence: @deepseek-ai/cordis package.json has no yaml dependency, and
    // this package's node_modules has neither `yaml` nor `js-yaml`. Upstream
    // include uses js-yaml; we cannot import it without installing.
    const require = createRequire(import.meta.url)
    expect(() => require.resolve('yaml')).toThrow()
    expect(() => require.resolve('js-yaml')).toThrow()

    const doc = readPatch()
    const entries = asEntries(doc)
    expect(entries.length).toBeGreaterThanOrEqual(3)
    expect(entries.map((e) => e.id ?? 'insert')).toEqual([
      'llm-pi-ai',
      'agent-default-model',
      'insert',
    ])
  })

  it('provider shape matches llm-pi-ai structural expectations (schema package not importable here)', () => {
    // @deepseek-ai/dsh-llm-pi-ai is a host runtime peer, not installed in this
    // package — structural checks mirror PiAiProviderProfile / modelFields.
    const openllm = openllmProvider(readPatch())
    expect(openllm.api).toBe('openai-completions')
    expect(openllm.baseURL).toBe('http://127.0.0.1:8787/v1')
    expect(openllm.displayName).toBe('OpenLLM')
    expect(openllm.headers).toEqual({ Authorization: 'Bearer local' })
    expect(Array.isArray(openllm.models)).toBe(true)
    expect(openllm.compat).toEqual({ supportsDeveloperRole: false })
    expect(typeof openllm.reasoning).toBe('string')
    expect(Array.isArray(openllm.defaultInput)).toBe(true)

    for (const model of openllm.models as Record<string, unknown>[]) {
      expect(typeof model.id).toBe('string')
      expect(typeof model.name).toBe('string')
      expect(typeof model.contextWindow).toBe('number')
      expect(typeof model.maxTokens).toBe('number')
      expect(model.reasoningEfforts).toBeTypeOf('object')
    }

    const defaults = asEntries(readPatch()).find((e) => e.id === 'agent-default-model')
    expect(defaults?.config).toEqual({ provider: 'openllm', model: 'ultra' })
  })

  it('enables image input via provider defaultInput', () => {
    const openllm = openllmProvider(readPatch())
    expect(openllm.defaultInput).toEqual(['text', 'image'])
  })

  it('maps thinking levels to allowed OpenLLM reasoning_effort values only', () => {
    const openllm = openllmProvider(readPatch())
    expect(openllm.reasoning).toBe('medium')
    const allowed = new Set<string>(OPENLLM_REASONING_EFFORTS)
    for (const model of openllm.models as Record<string, unknown>[]) {
      const efforts = model.reasoningEfforts as Record<string, string>
      expect(Object.keys(efforts).sort()).toEqual([...PI_THINKING_LEVELS].sort())
      for (const level of PI_THINKING_LEVELS) {
        expect(allowed.has(efforts[level]!)).toBe(true)
      }
      expect(efforts.off).toBe('none')
      expect(efforts.minimal).toBe('minimal')
      expect(efforts.low).toBe('low')
      expect(efforts.medium).toBe('medium')
      expect(efforts.high).toBe('high')
      expect(efforts.xhigh).toBe('xhigh')
      expect(efforts.max).toBe('max')
    }
  })

  it('sets only the evidenced compat override (supportsDeveloperRole false)', () => {
    const openllm = openllmProvider(readPatch())
    expect(openllm.compat).toEqual({ supportsDeveloperRole: false })
    // Defaults for an unknown openai-completions URL already use
    // max_completion_tokens, supportsReasoningEffort true, thinkingFormat openai,
    // and store:false — OpenLLM accepts those; do not invent extra flags.
    expect(openllm.compat).not.toHaveProperty('supportsStore')
    expect(openllm.compat).not.toHaveProperty('maxTokensField')
    expect(openllm.compat).not.toHaveProperty('supportsReasoningEffort')
    expect(openllm.compat).not.toHaveProperty('thinkingFormat')
  })

  it('MCP command resolves installer binary via !!js HOME and args mcp', () => {
    const mcp = mcpEntry(readPatch())
    expect(mcp.name).toBe('@deepseek-ai/dsh-mcp-client')
    expect(mcp.config?.transport).toBe('stdio')
    expect(mcp.config?.serverName).toBe('openllm')
    expect(mcp.config?.args).toEqual(['mcp'])
    const command = mcp.config?.command as JsExpr
    expect(typeof command.__jsExpr).toBe('string')
    // Evaluate the expression the same way the cordis loader does (new Function
    // with a `process` in scope) for both a set and an unset HOME.
    const evaluate = (env: Record<string, string | undefined>) =>
      new Function('process', `return (${command.__jsExpr})`)({ env }) as string
    expect(evaluate({ HOME: '/Users/test' })).toBe('/Users/test/.openllm/bin/openllm')
    expect(evaluate({})).toBe('openllm')
  })

  it('keeps failOnStartupError false and a short reconnect initialDelayMs', () => {
    const mcp = mcpEntry(readPatch())
    expect(mcp.config?.failOnStartupError).toBe(false)
    expect(mcp.config?.reconnect).toEqual({
      enabled: true,
      initialDelayMs: 100,
    })
  })

  it('package metadata is 0.2.0 with exports, dsh.bundle.patch, files, and publishConfig', () => {
    const pkg = readPackageJson()
    expect(pkg.name).toBe('@openllmsh/dsh')
    expect(pkg.version).toBe('0.2.0')
    expect(pkg.files).toEqual(['lib', 'cordis.patch.yml', 'assets'])
    expect(pkg.publishConfig).toEqual({ access: 'public' })
    expect(pkg.dsh).toEqual({ bundle: { patch: './cordis.patch.yml' } })
    expect(pkg.exports).toMatchObject({
      '.': {
        types: './lib/index.d.mts',
        default: './lib/index.mjs',
      },
      './cordis.patch.yml': './cordis.patch.yml',
      './package.json': './package.json',
    })
    expect(pkg.scripts).toMatchObject({
      test: 'vitest run',
      prepublishOnly: 'pnpm build && pnpm typecheck && pnpm test',
    })
    expect(String(pkg.description)).not.toMatch(/—|–/)
  })

  it('npm pack --dry-run contents are limited to lib, cordis.patch.yml, README, LICENSE, package.json', () => {
    const raw = execFileSync(
      'npm',
      ['pack', '--dry-run', '--json'],
      { cwd: PACKAGE_PATH.replace(/package\.json$/, ''), encoding: 'utf8' },
    )
    const parsed = JSON.parse(raw) as Array<{ files: Array<{ path: string }> }>
    const files = (parsed[0]?.files ?? []).map((f) => f.path).sort()
    const allowedPrefixes = ['lib/', 'assets/', 'cordis.patch.yml', 'README.md', 'LICENSE', 'package.json']
    expect(files.length).toBeGreaterThan(0)
    for (const path of files) {
      const ok = allowedPrefixes.some(
        (prefix) => path === prefix || path.startsWith(prefix),
      )
      expect(ok, `unexpected pack path: ${path}`).toBe(true)
    }
    expect(files).toContain('package.json')
    expect(files).toContain('cordis.patch.yml')
    expect(files).toContain('README.md')
    expect(files).toContain('LICENSE')
    expect(files.some((f) => f.startsWith('lib/'))).toBe(true)
    expect(files.some((f) => f.startsWith('src/'))).toBe(false)
    expect(files.some((f) => f.startsWith('tests/'))).toBe(false)
    // silence unused import when tree-shaken oddly
    expect(PATCH_PATH.endsWith('cordis.patch.yml')).toBe(true)
  })
})
