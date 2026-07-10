import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

// [[spex-init]] / [[render-policy]] — the ADOPTION SURFACE: what `spex init` prints must be TRUE of what it
// planted (the success message once claimed governedRoots ["src"] while the template seeded ["."] — the
// first-minute lie a real field e2e hit), the one-step `--render` vote must land in the axis-correct config
// file and fail loud on an unknown word BEFORE writing anything, and the one-time vote hint must appear
// exactly while the vote is open on a host-tracked contract file — and retire once any explicit vote is set.

const SRC = dirname(fileURLToPath(import.meta.url))
const CLI = join(SRC, 'cli.ts')
const TSX = join(SRC, '..', 'node_modules', '.bin', 'tsx')
const TEMPLATE_ROOTS = JSON.stringify(JSON.parse(readFileSync(join(SRC, '..', 'templates', 'spexcode.json'), 'utf8')).lint.governedRoots)

function gitAvailable(): boolean {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true } catch { return false }
}

function freshRepo(opts: { trackedContract?: boolean } = {}) {
  const proj = mkdtempSync(join(tmpdir(), 'spex-init-'))
  const home = mkdtempSync(join(tmpdir(), 'spex-home-'))
  const codex = mkdtempSync(join(tmpdir(), 'spex-codex-'))
  const env = { ...process.env, SPEXCODE_HOME: home, CODEX_HOME: codex }
  const g = (...args: string[]) => execFileSync('git', ['-C', proj, ...args], { encoding: 'utf8', env })
  const spex = (...args: string[]) =>
    execFileSync(TSX, [CLI, ...args], { cwd: proj, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
  writeFileSync(join(proj, 'README.md'), '# app\n')
  if (opts.trackedContract) {
    writeFileSync(join(proj, 'CLAUDE.md'), '# team notes\nkeep me\n')
    writeFileSync(join(proj, 'AGENTS.md'), '# team agents\nkeep me\n')
  }
  g('add', '-A'); g('commit', '-qm', 'init')
  return { proj, env, g, spex }
}

test('init success message reports the governedRoots the template ACTUALLY ships — read from the planted file, drift-proof', { skip: !gitAvailable() && 'git not available' }, () => {
  const { spex } = freshRepo()
  const out = spex('init', '.')
  assert.ok(out.includes(`lint.governedRoots starts as ${TEMPLATE_ROOTS}`), `plant message names the template value ${TEMPLATE_ROOTS}: ${out}`)
  assert.ok(out.includes(`(currently ${TEMPLATE_ROOTS})`), 'next-steps names the LIVE planted value')
  assert.ok(!out.includes('["src"]') || TEMPLATE_ROOTS === '["src"]', 'no stale hardcoded ["src"] claim anywhere')
})

test('init --render: an unknown word fails loud BEFORE anything is written', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, spex } = freshRepo()
  assert.throws(() => spex('init', '.', '--render', 'invisible'), /committed \| ignored \| hidden/)
  assert.ok(!existsSync(join(proj, '.spec')), 'nothing was seeded for the bad word')
  assert.ok(!existsSync(join(proj, 'spexcode.json')), 'no config planted for the bad word')
})

test('init --render committed: the vote lands in spexcode.json (project fact) and the run renders committed', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, spex } = freshRepo()
  const out = spex('init', '.', '--render', 'committed')
  assert.match(out, /render policy voted: "committed" → spexcode\.json/)
  assert.equal(JSON.parse(readFileSync(join(proj, 'spexcode.json'), 'utf8')).render, 'committed')
  const gi = readFileSync(join(proj, '.gitignore'), 'utf8')
  assert.ok(!/^CLAUDE\.md$/m.test(gi), 'committed: render entries are NOT in the ignore block')
  assert.ok(gi.includes('.claude/settings.json'), 'machine facts still ignored')
  assert.ok(readFileSync(join(proj, 'CLAUDE.md'), 'utf8').includes('spexcode:start'), 'render present as an ordinary committable file')
  assert.ok(!out.includes('spex guide footprint.'), 'an explicit vote on the same run means NO hint')
})

test('init --render hidden: the vote lands in spexcode.local.json (host fact), spexcode.json untouched', { skip: !gitAvailable() && 'git not available' }, () => {
  const { proj, spex } = freshRepo({ trackedContract: true })
  spex('init', '.', '--render', 'hidden')
  assert.equal(JSON.parse(readFileSync(join(proj, 'spexcode.local.json'), 'utf8')).render, 'hidden')
  assert.equal(JSON.parse(readFileSync(join(proj, 'spexcode.json'), 'utf8')).render, undefined, 'the host fact never enters the committed file')
  const excl = readFileSync(join(proj, '.git', 'info', 'exclude'), 'utf8')
  assert.ok(excl.includes('spexcode:start'), 'hidden: ignore block lives in info/exclude')
})

test('the adoption vote hint prints exactly while the vote is open on a host-TRACKED contract file, and retires on an explicit vote', { skip: !gitAvailable() && 'git not available' }, () => {
  // no tracked contract file → no hint, even without a vote
  const plain = freshRepo()
  assert.ok(!plain.spex('init', '.').includes('spex guide footprint.'), 'plain repo: no hint (nothing is host-tracked)')

  // host-tracked CLAUDE.md/AGENTS.md + no vote → the hint prints, naming the three words + the honest M
  const host = freshRepo({ trackedContract: true })
  const out = host.spex('init', '.')
  assert.match(out, /CLAUDE\.md.*tracked by this repo|tracked by this repo/s, 'hint names the tracked file')
  for (const word of ['committed', 'ignored', 'hidden']) assert.ok(out.includes(word), `hint explains '${word}'`)
  assert.match(out, /spex guide footprint/, 'hint points at the model manual')
  assert.match(out, /spex init --render/, 'hint names the one-step flag')

  // the manual materialize surface repeats it while undecided…
  assert.match(host.spex('materialize'), /spex guide footprint/, 'materialize surface hints while the vote is open')
  // …and ANY explicit vote retires it (ignored — the default made explicit — counts as a decision)
  const cfg = JSON.parse(readFileSync(join(host.proj, 'spexcode.json'), 'utf8'))
  cfg.render = 'ignored'
  writeFileSync(join(host.proj, 'spexcode.json'), JSON.stringify(cfg, null, 2))
  assert.ok(!host.spex('materialize').includes('spex guide footprint'), 'an explicit vote retires the hint')
})
