// The workflow names its unit suites one workspace at a time, and that list is hand-maintained while the
// workspace set moves under it. Both directions have already failed in the field: a folded-away package left
// `npm test --workspace=@spexcode/terminal-ui` behind and every run died on "No workspaces found", and three
// workspaces that do ship a test script (eval, forge, dashboard) were simply never named, so 438 dashboard
// tests ran nowhere. This proves the two sets agree, so neither drift can reach main quietly.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')

function manifest(dir) {
  const path = join(root, dir, 'package.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

// The root's workspace globs are the only roster; a `packages/*` entry expands to its real directories.
export function workspaceDirs() {
  const globs = manifest('.').workspaces ?? []
  return globs.flatMap((glob) => {
    if (!glob.endsWith('/*')) return [glob]
    const parent = glob.slice(0, -2)
    return readdirSync(join(root, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && manifest(join(parent, entry.name)))
      .map((entry) => join(parent, entry.name))
  })
}

const workspaces = workspaceDirs().map((dir) => ({ dir, ...manifest(dir) }))
const byName = new Map(workspaces.map((w) => [w.name, w]))
const named = [...workflow.matchAll(/--workspace=(\S+)/g)].map((m) => m[1])

// A step may also run a suite from inside the package (`working-directory: spec-cli` + `run: npm test`).
const viaWorkingDirectory = new Set(
  [...workflow.matchAll(/working-directory:\s*(\S+)\s*\n\s*run:\s*npm test\b/g)].map((m) => m[1]),
)

test('every workspace the workflow names still exists', () => {
  for (const name of named) {
    assert.ok(byName.has(name), `ci.yml runs --workspace=${name}, which no workspace declares; drop the line or restore the package`)
  }
})

test('every workspace that ships a test script is run by the workflow', () => {
  const missing = workspaces
    .filter((w) => w.scripts?.test)
    .filter((w) => !named.includes(w.name) && !viaWorkingDirectory.has(w.dir))
    .map((w) => `${w.name} (${w.dir})`)
  assert.deepEqual(missing, [], `these workspaces have tests no CI step runs: ${missing.join(', ')}`)
})

test('the workflow names no workspace twice', () => {
  const seen = named.filter((name, i) => named.indexOf(name) !== i)
  assert.deepEqual(seen, [], `duplicated --workspace entries: ${seen.join(', ')}`)
})
