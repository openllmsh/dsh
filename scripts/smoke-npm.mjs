import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const tarball = process.argv[2]
if (!tarball || process.argv.length !== 3) throw new Error('Usage: node scripts/smoke-npm.mjs <tarball>')
const expected = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'))
const temp = mkdtempSync(resolve(tmpdir(), 'dsh-smoke-'))
try {
  execFileSync('tar', ['-xzf', resolve(tarball), '-C', temp])
  const root = resolve(temp, 'package')
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  assert.equal(manifest.name, '@openllmsh/dsh')
  assert.equal(manifest.version, expected.version)
  const patchPath = manifest.dsh?.bundle?.patch
  assert.ok(typeof patchPath === 'string' && patchPath.length, 'missing dsh.bundle.patch')
  const patch = resolve(root, patchPath)
  assert.ok(patch.startsWith(root + '/'), 'patch must be inside package')
  const yaml = readFileSync(patch, 'utf8')
  assert.match(yaml, /^\s+openllm:\s*$/m, 'missing openllm provider')
  assert.match(yaml, /^\s*- id: mcp-openllm\s*$/m, 'missing mcp-openllm entry')
  assert.ok(statSync(resolve(root, 'assets')).isDirectory(), 'missing assets directory')
  await import(pathToFileURL(resolve(root, 'lib/index.mjs')).href)
  console.log(`Smoke passed: ${manifest.name}@${manifest.version}`)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
