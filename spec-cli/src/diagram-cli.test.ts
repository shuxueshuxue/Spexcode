import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { tsxBin } from './tsx-bin.js'

// [[diagram-cli]] through the REAL `spex diagram` in throwaway repos: scaffold writes a diagram that already
// satisfies the tree rules and draws; check says exactly what is wrong until it passes.

const SRC = dirname(fileURLToPath(import.meta.url))
const CLI = join(SRC, 'cli.ts')
const TSX = tsxBin(join(SRC, '..'))
const skip = spawnSync('git', ['--version']).status !== 0 && 'git not available'

const node = (title: string, code?: string) => `---\ntitle: ${title}\n${code ? `code:\n  - ${code}\n` : ''}---\n# ${title}\n`

// project → alpha (governs src/a.ts), beta, .plugins; alpha → deep.
function repo(origin: string | null = 'https://github.com/example/project.git') {
  const root = mkdtempSync(join(tmpdir(), 'spex-diagram-cli-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  if (origin) git('remote', 'add', 'origin', origin)
  const files: Record<string, string> = {
    '.spec/spexcode.json': JSON.stringify({ lint: { governedRoots: ['src'] } }) + '\n',
    '.spec/project/spec.md': node('project'),
    '.spec/project/alpha/spec.md': node('alpha', 'src/a.ts'),
    '.spec/project/alpha/deep/spec.md': node('deep'),
    '.spec/project/beta/spec.md': node('beta'),
    '.spec/project/.plugins/spec.md': node('.plugins'),
    'src/a.ts': 'export const a = 1\n',
  }
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  git('add', '-A')
  git('commit', '-qm', 'seed')
  const spex = (...args: string[]) => {
    const run = spawnSync(process.execPath, [TSX, CLI, 'diagram', ...args], { cwd: root, encoding: 'utf8' })
    return { code: run.status ?? -1, out: `${run.stdout}${run.stderr}` }
  }
  const read = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'))
  return { root, git, spex, read }
}

test('scaffold draws the node\'s children with their evidence, and the result passes check as written', { skip }, () => {
  const { git, spex, read } = repo()
  const made = spex('scaffold', 'project')
  assert.equal(made.code, 0, made.out)
  const ir = read('.spec/project/diagram.json')
  assert.equal(ir.diagram_type, 'architecture')
  assert.deepEqual(ir.components.map((c: { id: string }) => c.id).sort(), ['.plugins', 'alpha', 'beta'])
  assert.deepEqual(ir.meta.repository, { url: 'https://github.com/example/project', revision: git('rev-parse', 'HEAD') })
  assert.deepEqual(ir.components.find((c: { id: string }) => c.id === 'alpha').sources.map((s: { path: string }) => s.path), ['.spec/project/alpha/spec.md', 'src/a.ts'])
  const checked = spex('check', 'project')
  assert.equal(checked.code, 0, checked.out)
  assert.match(checked.out, /✓ archify draws it/)
  assert.match(checked.out, /✓ every box is a child of 'project'/)
  const json = JSON.parse(spex('check', 'project', '--json').out)
  assert.equal(json.ok, true)
})

test('scaffold never replaces a diagram without --force, and an architecture needs children', { skip }, () => {
  const { spex } = repo()
  assert.equal(spex('scaffold', 'project').code, 0)
  const again = spex('scaffold', 'project')
  assert.equal(again.code, 2)
  assert.match(again.out, /already exists — edit it, or pass --force/)
  assert.equal(spex('scaffold', 'project', '--force').code, 0)
  const leaf = spex('scaffold', 'beta')
  assert.equal(leaf.code, 2)
  assert.match(leaf.out, /'beta' has no children/)
  const stranger = spex('check', 'nowhere')
  assert.equal(stranger.code, 2)
  assert.match(stranger.out, /no spec node 'nowhere' — find its id with: spex spec search/)
})

test('check names each problem: a stranger box, a file that is not JSON, a missing file', { skip }, () => {
  const { root, spex, read } = repo()
  const missing = spex('check', 'project')
  assert.equal(missing.code, 1)
  assert.match(missing.out, /does not exist — start one with: spex diagram scaffold project/)
  spex('scaffold', 'project')
  const ir = read('.spec/project/diagram.json')
  ir.components.push({ id: 'gamma', type: 'backend', label: 'gamma', pos: [600, 400], size: [180, 64] })
  writeFileSync(join(root, '.spec/project/diagram.json'), JSON.stringify(ir))
  const stray = spex('check', 'project')
  assert.equal(stray.code, 1, stray.out)
  assert.match(stray.out, /✗ diagram-id: box 'gamma'/)
  writeFileSync(join(root, '.spec/project/diagram.json'), '{ not json')
  const broken = spex('check', 'project')
  assert.equal(broken.code, 1)
  assert.match(broken.out, /is not JSON/)
})

test('another kind starts from archify\'s own example and draws; off GitHub, scaffold writes no sources', { skip }, () => {
  const { spex, read } = repo(null)
  assert.equal(spex('scaffold', 'beta', '--type', 'workflow').code, 0)
  assert.equal(read('.spec/project/beta/diagram.json').diagram_type, 'workflow')
  assert.equal(read('.spec/project/beta/diagram.json').meta.title, 'beta')
  const flow = spex('check', 'beta')
  assert.equal(flow.code, 0, flow.out)
  const made = spex('scaffold', 'project')
  assert.match(made.out, /no sources: the origin is not a GitHub or Gitee repository/)
  const ir = read('.spec/project/diagram.json')
  assert.equal(ir.meta.repository, undefined)
  assert.ok(ir.components.every((c: { sources?: unknown }) => c.sources === undefined))
  assert.equal(spex('check', 'project').code, 0)
})
