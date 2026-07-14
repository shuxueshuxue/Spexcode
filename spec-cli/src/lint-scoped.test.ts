import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

// [[code-anchor]] YATU CLI cases — the runtime semantics of measured multi-selectors and scoped
// related, through the REAL `spex spec lint` in throwaway git repos (real stderr + exit code, never
// engine internals): multi-hit dedupe, cross-file one-govern, duplicate/mix integrity, owners
// exclusion, the scopedCodeMiss setting (default warn / ignore), related selector hit vs miss, bare
// compatibility, and the unsupported-extractor error.

const SRC = dirname(fileURLToPath(import.meta.url))
const CLI = join(SRC, 'cli.ts')
const TSX = join(SRC, '..', 'node_modules', '.bin', 'tsx')

function gitAvailable(): boolean {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true } catch { return false }
}
const skip = !gitAvailable() && 'git not available'

const UNIT = (name: string, body: string) => `export function ${name}() {\n  return ${body}\n}\n`
const CALC = (a: string, h: string, o = '3') => UNIT('applyRate', a) + UNIT('helper', h) + UNIT('other', o)

type Fx = {
  proj: string
  g: (...a: string[]) => string
  lint: () => { code: number; out: string }
  node: (id: string, fm: string) => void
  commit: (msg: string) => void
}
// a governed fixture repo: src/calc.ts + a .spec tree; each node's spec.md and the source land in ONE
// seed commit (the node's v1), so follow-up commits shape each scenario's drift window.
function fixture(): Fx {
  const proj = mkdtempSync(join(tmpdir(), 'spex-scoped-'))
  const g = (...args: string[]) => execFileSync('git', ['-C', proj, ...args], { encoding: 'utf8' }).trim()
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
  // the ts-ast extractor resolves the HOST project's typescript by walking up from the repo root
  symlinkSync(join(SRC, '..', 'node_modules'), join(proj, 'node_modules'))
  writeFileSync(join(proj, '.gitignore'), 'node_modules\n')
  writeFileSync(join(proj, 'spexcode.json'), JSON.stringify({ lint: { governedRoots: ['src'] } }) + '\n')
  mkdirSync(join(proj, 'src'))
  writeFileSync(join(proj, 'src/calc.ts'), CALC('1', '2'))
  mkdirSync(join(proj, '.spec/proj'), { recursive: true })
  writeFileSync(join(proj, '.spec/proj/spec.md'), '---\ntitle: proj\n---\n# proj\n')
  const node = (id: string, fm: string) => {
    mkdirSync(join(proj, '.spec/proj', id), { recursive: true })
    writeFileSync(join(proj, '.spec/proj', id, 'spec.md'), `---\ntitle: ${id}\n${fm}\n---\n# ${id}\n`)
  }
  const commit = (msg: string) => { g('add', '-A'); g('commit', '-qm', msg) }
  const lint = () => {
    const r = spawnSync(TSX, [CLI, 'spec', 'lint'], { cwd: proj, encoding: 'utf8' })
    return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` }
  }
  return { proj, g, lint, node, commit }
}

test('multi-hit dedupe: one commit inside BOTH pinned units → ONE anchor-drift error naming both selectors', { skip }, () => {
  const fx = fixture()
  fx.node('calc', 'code:\n  - src/calc.ts#applyRate\n  - src/calc.ts#helper')
  fx.commit('v1')
  writeFileSync(join(fx.proj, 'src/calc.ts'), CALC('10', '20')) // touches applyRate AND helper
  fx.commit('move both units')
  const { code, out } = fx.lint()
  assert.equal(code, 1)
  const rows = out.split('\n').filter((l) => l.includes('anchor-drift'))
  assert.equal(rows.length, 1, `one commit = one error, not one per selector: ${out}`)
  assert.match(rows[0], /#applyRate, #helper/)
  assert.match(rows[0], /1 commit\(s\)/)
})

test('cross-file selectors stay a one-govern error (multi-selector never widens govern past ONE file)', { skip }, () => {
  const fx = fixture()
  writeFileSync(join(fx.proj, 'src/b.ts'), UNIT('g', '1'))
  fx.node('calc', 'code:\n  - src/calc.ts#applyRate\n  - src/b.ts#g')
  fx.commit('v1')
  const { code, out } = fx.lint()
  assert.equal(code, 1)
  assert.match(out, /one-govern.*'calc' governs 2 files/)
})

test('duplicate selector and bare/scoped mix are integrity errors', { skip }, () => {
  const fx = fixture()
  fx.node('dup', 'code:\n  - src/calc.ts#applyRate\n  - src/calc.ts#applyRate')
  fx.node('mix', 'related:\n  - src/calc.ts\n  - src/calc.ts#helper')
  fx.commit('v1')
  const { code, out } = fx.lint()
  assert.equal(code, 1)
  assert.match(out, /integrity: 'dup' code: lists selector 'src\/calc\.ts#applyRate' twice/)
  assert.match(out, /integrity: 'mix' related: mixes bare 'src\/calc\.ts'/)
})

test('owners bound counts whole-file governors only: 4 scoped nodes are quiet, 4 bare nodes warn', { skip }, () => {
  const scoped = fixture()
  for (const id of ['n1', 'n2', 'n3', 'n4']) scoped.node(id, 'code:\n  - src/calc.ts#applyRate')
  scoped.commit('v1')
  const s = scoped.lint()
  assert.equal(s.code, 0)
  assert.ok(!s.out.includes('owners'), `scoped governors must not trip the owners bound: ${s.out}`)

  const bare = fixture()
  for (const id of ['n1', 'n2', 'n3', 'n4']) bare.node(id, 'code:\n  - src/calc.ts')
  bare.commit('v1')
  const b = bare.lint()
  assert.match(b.out, /owners: 1 file\(s\) are governed by > 3 nodes/)
})

test('scoped miss keeps the advisory drift warn by DEFAULT; lint.scopedCodeMiss "ignore" silences ONLY that; a hit still blocks', { skip }, () => {
  const fx = fixture()
  fx.node('calc', 'code:\n  - src/calc.ts#applyRate')
  fx.commit('v1')
  writeFileSync(join(fx.proj, 'src/calc.ts'), CALC('1', '2', '30')) // touches only `other` — a MISS
  fx.commit('move a non-anchored unit')
  const miss = fx.lint()
  assert.equal(miss.code, 0, `a miss never blocks: ${miss.out}`)
  assert.match(miss.out, /drift: src\/calc\.ts is 1 commit\(s\) ahead/, 'default keeps the ordinary advisory')
  assert.ok(!miss.out.includes('anchor-drift'), 'no block on a miss')

  writeFileSync(join(fx.proj, 'spexcode.json'), JSON.stringify({ lint: { governedRoots: ['src'], scopedCodeMiss: 'ignore' } }) + '\n')
  const quiet = fx.lint()
  assert.equal(quiet.code, 0)
  assert.ok(!/drift: src\/calc\.ts/.test(quiet.out), `"ignore" silences the scoped miss advisory: ${quiet.out}`)

  writeFileSync(join(fx.proj, 'src/calc.ts'), CALC('99', '2', '30')) // now touch the anchored unit
  fx.commit('move the anchored unit')
  const hit = fx.lint()
  assert.equal(hit.code, 1, '"ignore" must NOT touch the hit block')
  assert.match(hit.out, /anchor-drift.*src\/calc\.ts#applyRate/)
})

test('related selector: a hit warns (soft, exit 0) naming the selector; a miss is silent', { skip }, () => {
  const fx = fixture()
  fx.node('watcher', 'related:\n  - src/calc.ts#applyRate')
  fx.commit('v1')
  writeFileSync(join(fx.proj, 'src/calc.ts'), CALC('1', '2', '30')) // touches only `other` — miss
  fx.commit('unrelated move')
  const miss = fx.lint()
  assert.equal(miss.code, 0)
  assert.ok(!miss.out.includes('related-drift'), `a scoped related miss is SILENT: ${miss.out}`)

  writeFileSync(join(fx.proj, 'src/calc.ts'), CALC('42', '2', '30')) // touches applyRate — hit
  fx.commit('move the watched unit')
  const hit = fx.lint()
  assert.equal(hit.code, 0, `related never blocks: ${hit.out}`)
  assert.match(hit.out, /related-drift: related src\/calc\.ts#applyRate \('watcher'\)/)
})

test('bare compatibility: whole-file code keeps ordinary drift, unaffected by scopedCodeMiss "ignore"', { skip }, () => {
  const fx = fixture()
  writeFileSync(join(fx.proj, 'spexcode.json'), JSON.stringify({ lint: { governedRoots: ['src'], scopedCodeMiss: 'ignore' } }) + '\n')
  fx.node('calc', 'code:\n  - src/calc.ts')
  fx.commit('v1')
  writeFileSync(join(fx.proj, 'src/calc.ts'), CALC('10', '2'))
  fx.commit('any change')
  const { code, out } = fx.lint()
  assert.equal(code, 0)
  assert.match(out, /drift: src\/calc\.ts is 1 commit\(s\) ahead/, 'bare drift is outside the knob')
  assert.ok(!out.includes('anchor-drift'))
})

test('no hidden selector cap: 4 valid same-file selectors lint clean and OR into one anchor-drift error', { skip }, () => {
  const fx = fixture()
  writeFileSync(join(fx.proj, 'src/calc.ts'), CALC('1', '2') + UNIT('fourth', '4'))
  fx.node('calc', 'code:\n  - src/calc.ts#applyRate\n  - src/calc.ts#helper\n  - src/calc.ts#other\n  - src/calc.ts#fourth')
  fx.commit('v1')
  const clean = fx.lint()
  assert.equal(clean.code, 0, `4 same-file selectors are legal — no cap: ${clean.out}`)
  assert.ok(!clean.out.includes('integrity') && !clean.out.includes('one-govern'), clean.out)
  writeFileSync(join(fx.proj, 'src/calc.ts'), CALC('1', '2') + UNIT('fourth', '40')) // hit the 4th unit
  fx.commit('move the fourth unit')
  const hit = fx.lint()
  assert.equal(hit.code, 1)
  assert.match(hit.out, /anchor-drift.*src\/calc\.ts#fourth/)
})

test('a selector on a language with no designated extractor is an integrity error with the repair', { skip }, () => {
  const fx = fixture()
  writeFileSync(join(fx.proj, 'src/tool.py'), 'def f():\n    pass\n')
  fx.node('py', 'code:\n  - src/tool.py#f')
  fx.commit('v1')
  const { code, out } = fx.lint()
  assert.equal(code, 1)
  assert.match(out, /integrity: 'py' anchors src\/tool\.py#f.*no extractor is designated/)
})
