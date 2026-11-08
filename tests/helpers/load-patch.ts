import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

export const PATCH_PATH = join(root, 'cordis.patch.yml')
export const PACKAGE_PATH = join(root, 'package.json')

export type JsExpr = { __jsExpr: string }

/**
 * Minimal loader for this bundle's cordis.patch.yml dialect.
 *
 * `@deepseek-ai/cordis` does not pull `yaml`/`js-yaml` into this package's
 * node_modules, and installing extra deps is out of scope — so tests use this
 * subset parser (comments, nested maps, sequences, flow maps, `!!js` scalars).
 * It is not a general YAML implementation.
 */
export function loadPatchYaml(source: string): unknown {
  const lines = source.split(/\r?\n/)
  let i = 0

  const peek = () => lines[i]
  const indentOf = (line: string) => line.match(/^ */)?.[0].length ?? 0

  function skipEmptyAndComments() {
    while (i < lines.length) {
      const line = peek()
      if (line === undefined) return
      if (line.trim() === '' || line.trimStart().startsWith('#')) {
        i += 1
        continue
      }
      return
    }
  }

  function parseScalar(raw: string): unknown {
    const value = raw.trim()
    if (value.startsWith('!!js ')) {
      let expr = value.slice('!!js '.length).trim()
      if (expr.length > 1 && expr.startsWith('"') && expr.endsWith('"')) expr = expr.slice(1, -1)
      return { __jsExpr: expr } satisfies JsExpr
    }
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      return value.slice(1, -1)
    }
    if (value === 'true') return true
    if (value === 'false') return false
    if (value === 'null' || value === '~' || value === '') return null
    if (/^-?\d+$/.test(value)) return Number(value)
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim()
      if (!inner) return []
      return inner.split(',').map((part) => parseScalar(part.trim()))
    }
    if (value.startsWith('{') && value.endsWith('}')) {
      const inner = value.slice(1, -1).trim()
      if (!inner) return {}
      const obj: Record<string, unknown> = {}
      for (const part of inner.split(',')) {
        const idx = part.indexOf(':')
        if (idx === -1) continue
        obj[part.slice(0, idx).trim()] = parseScalar(part.slice(idx + 1))
      }
      return obj
    }
    return value
  }

  function parseBlock(minIndent: number): unknown {
    skipEmptyAndComments()
    const first = peek()
    if (first === undefined) return null
    const ind = indentOf(first)
    if (ind < minIndent) return null
    if (first.trimStart().startsWith('- ')) return parseSequence(ind)
    return parseMapping(ind)
  }

  function parseSequence(seqIndent: number): unknown[] {
    const out: unknown[] = []
    while (i < lines.length) {
      skipEmptyAndComments()
      const line = peek()
      if (line === undefined) break
      const ind = indentOf(line)
      if (ind < seqIndent) break
      if (ind > seqIndent) {
        throw new Error(`unexpected deeper indent at line ${i + 1}: ${line}`)
      }
      if (!line.trimStart().startsWith('- ')) break
      const rest = line.trimStart().slice(2)
      i += 1
      if (rest === '') {
        out.push(parseBlock(seqIndent + 2))
        continue
      }
      const colon = rest.indexOf(':')
      if (colon !== -1 && !rest.trimStart().startsWith('{') && !rest.trimStart().startsWith('[')) {
        // Inline mapping start on the same line as `- key: value`
        const key = rest.slice(0, colon).trim()
        const after = rest.slice(colon + 1).trim()
        const obj: Record<string, unknown> = {}
        if (after !== '') {
          obj[key] = parseScalar(after)
        } else {
          obj[key] = parseBlock(seqIndent + 2)
        }
        Object.assign(obj, parseMappingContinuation(seqIndent + 2))
        out.push(obj)
      } else {
        out.push(parseScalar(rest))
      }
    }
    return out
  }

  function parseMappingContinuation(mapIndent: number): Record<string, unknown> {
    const obj: Record<string, unknown> = {}
    while (i < lines.length) {
      skipEmptyAndComments()
      const line = peek()
      if (line === undefined) break
      const ind = indentOf(line)
      if (ind < mapIndent) break
      if (ind > mapIndent) {
        throw new Error(`unexpected deeper indent at line ${i + 1}: ${line}`)
      }
      if (line.trimStart().startsWith('- ')) break
      const trimmed = line.trim()
      const colon = trimmed.indexOf(':')
      if (colon === -1) {
        throw new Error(`expected mapping at line ${i + 1}: ${line}`)
      }
      const key = trimmed.slice(0, colon).trim()
      const after = trimmed.slice(colon + 1).trim()
      i += 1
      if (after === '') {
        skipEmptyAndComments()
        const next = peek()
        if (next !== undefined && indentOf(next) > mapIndent) {
          obj[key] = parseBlock(mapIndent + 1)
        } else {
          obj[key] = null
        }
      } else {
        obj[key] = parseScalar(after)
      }
    }
    return obj
  }

  function parseMapping(mapIndent: number): Record<string, unknown> {
    return parseMappingContinuation(mapIndent)
  }

  const doc = parseBlock(0)
  skipEmptyAndComments()
  if (i < lines.length) {
    // Top-level document is a sequence; parseBlock already consumed it.
  }
  return doc
}

export function readPatch(): unknown {
  return loadPatchYaml(readFileSync(PATCH_PATH, 'utf8'))
}

export function readPackageJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(PACKAGE_PATH, 'utf8')) as Record<string, unknown>
}

export const OPENLLM_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export const PI_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const
