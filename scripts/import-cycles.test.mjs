// A runtime import cycle is a module that has to be half-initialized for its own dependency to finish
// loading. ES modules tolerate it until they don't: the failure is a TDZ error or an undefined binding at
// the exact moment a new import order is introduced, far from the edge that caused it.
//
// Three of them had formed here, and each was the same mistake — a leaf question asked through a module
// that also holds implementations:
//   * `tabs.js` asked views.jsx whether a page is a document; views.jsx eagerly imports SessionsView, so
//     twelve dashboard modules became one cycle ([[view-catalog]]).
//   * `gateway-hub.ts` and `machine-peer.ts` read the endpoint record from host.ts, which imports both of
//     them to mount the gateway ([[endpoint-record]]).
//   * `opencode-headless.ts` took a shell helper from harness.ts, which imports it to build its adapter.
// None was visible in review, because each single import looks reasonable.
//
// So the check is the graph, not a rule of thumb. It counts only edges that force initialization order:
// value imports resolved to files in this repository. `import type` is erased before runtime, and a
// dynamic `import()` is deferred by construction, so neither is a cycle — the dashboard's lazy view
// importers and the session protocol's barrel are both fine and must stay allowed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const TEST_FILE = /(\.test\.|\.spec\.|(^|\/)(test|tests|__fixtures__)\/)/

// git is the file roster: it excludes build output, node_modules and anything untracked without needing a
// second ignore list to keep in step with .gitignore.
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && SOURCE.test(f) && !TEST_FILE.test(f) && existsSync(join(root, f)))

const files = new Set(tracked)

// TypeScript source imports `./x.js` and means `./x.ts`; JSX does the same for `.jsx`/`.tsx`. Resolution
// mirrors what the bundler and tsc actually do, so an edge is never missed by spelling alone.
function resolveImport(from, specifier) {
  if (!specifier.startsWith('.')) return null
  const base = normalize(join(dirname(from), specifier))
  const candidates = [
    base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}.cjs`,
    base.replace(/\.js$/, '.ts'), base.replace(/\.jsx$/, '.tsx'), base.replace(/\.mjs$/, '.mts'),
    join(base, 'index.ts'), join(base, 'index.tsx'), join(base, 'index.js'), join(base, 'index.jsx'), join(base, 'index.mjs'),
  ]
  return candidates.find((candidate) => files.has(candidate)) ?? null
}

const VALUE_IMPORT = /(?:^|\n)(\s*(?:import|export)[^;\n]*?from\s+['"]([^'"]+)['"])/g
const TYPE_ONLY = /^\s*(?:import|export)\s+type\b/

export function importGraph() {
  const edges = new Map()
  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8')
    const out = new Set()
    for (const [, statement, specifier] of source.matchAll(VALUE_IMPORT)) {
      if (TYPE_ONLY.test(statement)) continue
      const target = resolveImport(file, specifier)
      if (target && target !== file) out.add(target)
    }
    edges.set(file, out)
  }
  return edges
}

// Tarjan: every strongly connected component larger than one node is a cycle, and reporting the component
// rather than one arbitrary path names every module a reader has to look at.
export function cycles(edges) {
  let counter = 0
  const index = new Map(), low = new Map(), stack = [], onStack = new Set(), found = []
  const visit = (node) => {
    index.set(node, counter); low.set(node, counter); counter++
    stack.push(node); onStack.add(node)
    for (const next of edges.get(node) ?? []) {
      if (!index.has(next)) { visit(next); low.set(node, Math.min(low.get(node), low.get(next))) }
      else if (onStack.has(next)) low.set(node, Math.min(low.get(node), index.get(next)))
    }
    if (low.get(node) === index.get(node)) {
      const component = []
      let popped
      do { popped = stack.pop(); onStack.delete(popped); component.push(popped) } while (popped !== node)
      if (component.length > 1) found.push(component.sort())
    }
  }
  for (const node of edges.keys()) if (!index.has(node)) visit(node)
  return found
}

test('no module needs itself to finish loading', () => {
  const found = cycles(importGraph())
  const report = found
    .sort((a, b) => b.length - a.length)
    .map((component) => `  [${component.length}] ${component.map((f) => relative(root, f)).join(' -> ')}`)
    .join('\n')
  assert.deepEqual(found, [], found.length ? `runtime import cycles:\n${report}` : '')
})

test('the graph is large enough to be a real answer', () => {
  const edges = importGraph()
  const total = [...edges.values()].reduce((sum, out) => sum + out.size, 0)
  // A resolver that silently stopped matching would report a clean graph with almost no edges, which reads
  // exactly like success. Pin a floor so that failure is loud instead.
  assert.ok(edges.size > 250, `only ${edges.size} source files found; the roster is broken`)
  assert.ok(total > 500, `only ${total} internal import edges resolved; the resolver is broken`)
})
