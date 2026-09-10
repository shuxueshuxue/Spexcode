import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { extractors } from '@spexcode/spec-core'
import { specLint } from './lint.js'
import { tsxBin } from './tsx-bin.js'

// [[diagram]]'s two lint errors through the REAL `spex spec lint` in throwaway repos: a node's architecture
// diagram draws its own children (box id = child node id, or `others`) and cites only specs or governed files.

const SRC = dirname(fileURLToPath(import.meta.url))
const CLI = join(SRC, 'cli.ts')
const TSX = tsxBin(join(SRC, '..'))
const skip = spawnSync('git', ['--version']).status !== 0 && 'git not available'

const node = (title: string, code?: string) => `---\ntitle: ${title}\n${code ? `code:\n  - ${code}\n` : ''}---\n# ${title}\n`
const box = (id: string, sources: string[] = []) =>
  ({ id, type: 'backend', label: id, pos: [40, 40], size: [160, 60], ...(sources.length ? { sources: sources.map((path) => ({ path, label: 'spec' })) } : {}) })
const diagram = (components: object[]) => JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'project' }, components, connections: [] })

// project → alpha (governs src/a.ts) → deep; project → beta, .plugins. src/loose.ts is governed by nobody.
function repo(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'spex-diagram-lint-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  const all: Record<string, string> = {
    '.spec/spexcode.json': JSON.stringify({ lint: { governedRoots: ['src'] } }) + '\n',
    '.spec/project/spec.md': node('project'),
    '.spec/project/alpha/spec.md': node('alpha', 'src/a.ts'),
    '.spec/project/alpha/deep/spec.md': node('deep'),
    '.spec/project/beta/spec.md': node('beta'),
    '.spec/project/.plugins/spec.md': node('.plugins'),
    'src/a.ts': 'export const a = 1\n',
    'src/loose.ts': 'export const loose = 1\n',
    ...files,
  }
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  git('add', '-A')
  git('commit', '-qm', 'seed')
  return { root, git }
}
const lint = (root: string) => {
  const run = spawnSync(process.execPath, [TSX, CLI, 'spec', 'lint'], { cwd: root, encoding: 'utf8' })
  const out = `${run.stdout}${run.stderr}`
  return { code: run.status ?? -1, out, diagram: out.split('\n').filter((line) => /diagram-(id|source)/.test(line)) }
}

test('a diagram of the node\'s own children, citing specs and governed files, is clean — `.plugins` and `others` included', { skip }, () => {
  const { root } = repo({
    '.spec/project/diagram.architecture.json': diagram([
      box('alpha', ['.spec/project/alpha/spec.md', 'src/a.ts']), box('.plugins', ['.spec/project/.plugins/spec.md']), box('others'),
    ]),
  })
  const r = lint(root)
  assert.deepEqual(r.diagram, [], r.out)
  assert.equal(r.code, 0, r.out)
})

test('a box that is not a direct child is a diagram-id error — a stranger, a grandchild, an alias', { skip }, () => {
  const { root } = repo({ '.spec/project/diagram.architecture.json': diagram([box('alpha'), box('gamma'), box('deep'), box('x-plugins')]) })
  const r = lint(root)
  assert.equal(r.code, 1, r.out)
  assert.equal(r.diagram.length, 3, r.out)
  for (const id of ['gamma', 'deep', 'x-plugins']) assert.ok(r.diagram.some((line) => line.includes(`box '${id}'`) && line.includes('diagram-id')), `${id}: ${r.out}`)
  assert.match(r.out, /children: \.plugins, alpha, beta/)
})

test('a cited source that is neither a spec nor a governed file is a diagram-source error', { skip }, () => {
  const { root } = repo({
    '.spec/project/diagram.architecture.json': diagram([box('alpha', ['src/loose.ts', 'src/gone.ts', '.spec/project/alpha/spec.md'])]),
  })
  const r = lint(root)
  assert.equal(r.code, 1, r.out)
  assert.deepEqual(r.diagram.map((line) => line.match(/cites (\S+)/)?.[1]), ['src/loose.ts,', 'src/gone.ts,'], r.out)
})

test('an architecture diagram that is not JSON cannot be checked, and says so; other diagram types are not read', { skip }, () => {
  const { root } = repo({
    '.spec/project/diagram.architecture.json': '{ not json',
    '.spec/project/alpha/diagram.workflow.json': JSON.stringify({ steps: [{ id: 'anything' }] }),
  })
  const r = lint(root)
  assert.equal(r.diagram.length, 1, r.out)
  assert.match(r.diagram[0], /diagram-id: .*diagram\.architecture\.json is not JSON/)
})

test('the commit gate judges the candidate tree, not the working files', { skip }, async () => {
  const { root, git } = repo({ '.spec/project/diagram.architecture.json': diagram([box('gamma')]) })
  const bad = git('rev-parse', 'HEAD').trim()
  writeFileSync(join(root, '.spec/project/diagram.architecture.json'), diagram([box('alpha')]))
  git('commit', '-qam', 'fix the box')
  const clean = await specLint(root, extractors(root))
  assert.deepEqual(clean.filter((f) => f.rule.startsWith('diagram-')), [])
  const atBad = await specLint(root, extractors(root), { tip: bad })
  assert.deepEqual(atBad.filter((f) => f.rule.startsWith('diagram-')).map((f) => f.rule), ['diagram-id'])
})
