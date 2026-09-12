import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// @@@two-copies-one-rule - the plugin tree is tracked twice: the authoring copy this repository governs, and
// the copy `spex init` seeds an adopter from. Nothing generates either of them. This file states the rule the
// two must satisfy and fails loudly when they stop satisfying it — it never writes.
//
// It used to write. `--write` was the escape hatch that let the seed rot: the recorded failure (issue
// `the-adopter-plugin-seed-is-nine-differences-behi`) is nine files "written by an older projection and never
// regenerated", which is a sentence only a generator can produce. A check has no such state — either the two
// copies say the same thing or the gate is red, and the fix is to make them say the same thing.
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
export const LIVE_PLUGINS = join(root, '.spec', 'spexcode', '.plugins')
export const INIT_PLUGINS = join(root, 'spec-cli', 'templates', 'spec', 'project', '.plugins')

const frontmatter = (source) => source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1] ?? ''
const heldBack = (body) => /^seed:\s*false\s*$/m.test(frontmatter(body))

function walk(dir, base = dir, out = new Map()) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, base, out)
    else out.set(relative(base, path), path)
  }
  return out
}

function specIds(specRoot) {
  const ids = new Set()
  const visit = (dir) => {
    if (existsSync(join(dir, 'spec.md'))) ids.add(basename(dir))
    for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) visit(join(dir, e.name))
  }
  visit(specRoot)
  return ids
}

// THE TWO LEGITIMATE DIFFERENCES, and there are only two: the seed names its own spec root, and it carries no
// `seed:` field because a tree that was seeded has nothing left to decide about seeding.
const SOURCE_PREFIX = '.spec/spexcode/.plugins'
const TARGET_PREFIX = '.spec/project/.plugins'
const asSeed = (body, isSpec) => {
  const routed = body.replaceAll(SOURCE_PREFIX, TARGET_PREFIX)
  return isSpec ? routed.replace(/^seed:\s*(?:true|false)\s*\n/m, '') : routed
}

// A `[[link]]` to a node this repository has and the seed does not ship would reach an adopter as a dangling
// mention — an error in THEIR lint, for a node they never wrote. So it is refused here rather than silently
// rewritten on the way out: a rule an author can follow beats a rewrite they never see. Fenced blocks and
// inline code are skipped, because `[[node-id]]` and `` `[[links]]` `` in those are the syntax being taught.
function danglingLinks(body, known, seeded) {
  const out = []
  let fenced = false
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue }
    if (fenced) continue
    line.split(/(`+[^`]*`+)/g).forEach((part, index) => {
      if (index % 2) return
      for (const [, target] of part.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
        const id = target.trim()
        if (known.has(id) && !seeded.has(id)) out.push(id)
      }
    })
  }
  return out
}

// the tracked seed, read as bytes — what `spex init` will plant and what the distribution and smoke scripts
// inspect. They used to ask a projection to compute it; the seed is a file tree, so they read the file tree.
export function seedFiles(dir = INIT_PLUGINS) {
  return new Map([...walk(dir)].map(([rel, path]) => [rel, { content: readFileSync(path), mode: statSync(path).mode }]))
}

// compare a seed-shaped map against a directory on disk (an init'd project's `.plugins`, in the smoke test).
export function diffAgainst(files, targetDir) {
  const actual = walk(targetDir)
  const out = []
  for (const rel of [...new Set([...files.keys(), ...actual.keys()])].sort()) {
    const expected = files.get(rel)
    const path = actual.get(rel)
    if (!expected) out.push(`extra: ${rel}`)
    else if (!path) out.push(`missing: ${rel}`)
    else if (!expected.content.equals(readFileSync(path))) out.push(`content: ${rel}`)
    else if ((expected.mode & 0o111) !== (statSync(path).mode & 0o111)) out.push(`mode: ${rel}`)
  }
  return out
}

export function initPluginDifferences({ sourceDir = LIVE_PLUGINS, targetDir = INIT_PLUGINS, specRoot = join(root, '.spec', 'spexcode') } = {}) {
  const source = walk(sourceDir)
  const target = walk(targetDir)
  const known = specIds(specRoot)
  const seeded = specIds(targetDir)   // every node the seed ships, the shelf roots included
  const differences = []
  const shipped = new Map()
  for (const [rel, path] of source) {
    const dir = join(sourceDir, rel, '..')
    const spec = join(dir, 'spec.md')
    if (existsSync(spec) && heldBack(readFileSync(spec, 'utf8'))) continue   // `seed: false` — not shipped
    shipped.set(rel, path)
  }
  for (const rel of [...new Set([...shipped.keys(), ...target.keys()])].sort()) {
    const from = shipped.get(rel)
    const to = target.get(rel)
    if (!from) { differences.push(`extra in the seed: ${rel}`); continue }
    if (!to) { differences.push(`missing from the seed: ${rel}`); continue }
    const body = readFileSync(from, 'utf8')
    if (asSeed(body, basename(rel) === 'spec.md') !== readFileSync(to, 'utf8')) differences.push(`content: ${rel}`)
    if ((statSync(from).mode & 0o111) !== (statSync(to).mode & 0o111)) differences.push(`mode: ${rel}`)
    if (basename(rel) === 'spec.md') {
      for (const id of danglingLinks(body, known, seeded)) {
        differences.push(`link: ${rel} names [[${id}]], which the seed does not ship — write it as plain text`)
      }
    }
  }
  return differences
}

function main() {
  const differences = initPluginDifferences()
  if (differences.length) {
    console.error(`init plugin parity failed (${differences.length}):\n${differences.map((d) => `  - ${d}`).join('\n')}\n`
      + `The seed under ${relative(root, INIT_PLUGINS)} is a tracked copy of ${relative(root, LIVE_PLUGINS)}, differing only by the spec root name and the dropped \`seed:\` line. Edit both.`)
    process.exitCode = 1
    return
  }
  console.log(`init plugin parity: ${walk(INIT_PLUGINS).size} seed files match the plugin tree`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
