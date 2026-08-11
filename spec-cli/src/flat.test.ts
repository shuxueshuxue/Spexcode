import test from 'node:test'
import assert from 'node:assert/strict'
import { gatePassed, profileFiles, readGate, type FlatGate } from './flat.js'
import { HARNESSES, harnessById } from './harness.js'

test('profiling governs tracked source and ignores what no spec could claim', () => {
  const profile = profileFiles([
    'src/index.ts', 'src/app.tsx', 'src/util.ts',
    'server/main.py', 'server/db.py',
    'README.md', 'package-lock.json', 'LICENSE', '.gitignore', 'Makefile',
    'vendor/left-pad/index.js', 'dist/bundle.js', 'node_modules/x/y.js',
  ])
  assert.deepEqual(profile.sourceExtensions, ['py', 'ts', 'tsx'])
  assert.deepEqual(profile.governedRoots, ['server', 'src'])
  assert.deepEqual(profile.languages, ['Python', 'TypeScript'])
  assert.equal(profile.fileCount, 5)
})

test('a repository with no recognised source profiles to nothing rather than to everything', () => {
  // The gate reads coverage over governed files. If an unrecognised repository profiled to a NON-empty
  // governed set of files no spec can describe, the loop could never close; if it profiled to an empty set,
  // coverage would be vacuously complete. Both are wrong, so this reports zero and the caller refuses.
  const profile = profileFiles(['README.md', 'docs/guide.md', 'assets/logo.svg', 'Cargo.lock'])
  assert.equal(profile.fileCount, 0)
  assert.deepEqual(profile.governedRoots, [])
  assert.deepEqual(profile.sourceExtensions, [])
})

test('a top-level source file makes the repository root the governed root', () => {
  const profile = profileFiles(['main.go', 'helper.go', 'go.mod'])
  assert.deepEqual(profile.governedRoots, ['.'])
})

test('the gate reads coverage and errors out of the real lint report shape', () => {
  const gate = readGate(JSON.stringify({
    projection: 'spex.spec-lint.report',
    schemaVersion: 1,
    sourceFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
    findings: [
      { level: 'warn', rule: 'coverage', file: 'd.ts', msg: 'd.ts is governed by no spec' },
      { level: 'warn', rule: 'drift', file: 'a.ts', msg: 'a.ts is 2 commit(s) ahead' },
      { level: 'error', rule: 'integrity', spec: 'x', file: 'gone.ts', msg: "code path 'gone.ts' does not exist" },
    ],
  }))
  assert.equal(gate.governed, 4)
  assert.equal(gate.uncovered, 1)
  assert.equal(gate.coverage, 75)
  assert.equal(gate.errors, 1)
  assert.deepEqual(gate.uncoveredFiles, ['d.ts'])
  assert.match(gate.errorFindings[0], /^integrity: /)
})

test('drift and other warnings never block convergence — only errors and coverage do', () => {
  const drifty = readGate(JSON.stringify({
    sourceFiles: ['a.ts', 'b.ts'],
    findings: [
      { level: 'warn', rule: 'drift', file: 'a.ts', msg: 'stale' },
      { level: 'warn', rule: 'owners', file: 'b.ts', msg: 'no owner' },
    ],
  }))
  assert.equal(drifty.coverage, 100)
  assert.equal(drifty.errors, 0)
  assert.equal(gatePassed(drifty, 90), true)
})

test('an empty governed set never passes, however clean the report looks', () => {
  // The vacuous pass this exists to refuse: no source files, no findings, therefore "no problems".
  const vacuous = readGate(JSON.stringify({ sourceFiles: [], findings: [] }))
  assert.equal(vacuous.governed, 0)
  assert.equal(vacuous.errors, 0)
  assert.equal(gatePassed(vacuous, 0), false)
})

test('convergence needs both halves — a clean tree that is thin does not pass', () => {
  const thin: FlatGate = { errors: 0, governed: 100, uncovered: 40, coverage: 60, errorFindings: [], uncoveredFiles: [] }
  const broken: FlatGate = { errors: 3, governed: 100, uncovered: 0, coverage: 100, errorFindings: ['x'], uncoveredFiles: [] }
  const done: FlatGate = { errors: 0, governed: 100, uncovered: 5, coverage: 95, errorFindings: [], uncoveredFiles: [] }
  assert.equal(gatePassed(thin, 90), false)
  assert.equal(gatePassed(broken, 90), false)
  assert.equal(gatePassed(done, 90), true)
  assert.equal(gatePassed(done, 100), false)
})

test('an unparseable lint report is a failure, never a silent zero', () => {
  assert.throws(() => readGate('this is not json'))
})

test('every harness declaring a one-shot turn carries the prompt exactly one way', () => {
  const capable = HARNESSES.filter((harness) => harness.oneShotTurn)
  assert.ok(capable.length > 0, 'no harness can run a conversion round')
  for (const harness of capable) {
    const turn = harness.oneShotTurn!('PROMPT-BODY', undefined)
    assert.ok(turn.command.length > 0, `${harness.id} produced an empty command`)
    // Either the prompt is on stdin and absent from the command, or it is in the command and stdin is empty.
    // A prompt in both places would deliver the instruction twice.
    const inCommand = turn.command.includes('PROMPT-BODY')
    assert.equal(inCommand, turn.stdin === '', `${harness.id} carries the prompt ambiguously`)
  }
})

test('the launcher command is what actually runs the turn', () => {
  const claude = harnessById('claude')
  assert.equal(claude.oneShotTurn!('p', '/abs/path/reclaude --dangerously-skip-permissions').command,
    '/abs/path/reclaude --dangerously-skip-permissions -p')
  const codex = harnessById('codex')
  assert.equal(codex.oneShotTurn!('p', 'codex --yolo').command, 'codex --yolo exec -')
})

test('headless variants inherit the one-shot turn from their native family', () => {
  // They are built by object composition, so a family that can run a turn keeps that ability when the
  // resident half is swapped out. Losing it silently would refuse a launcher that in fact works.
  for (const id of ['claude-headless', 'codex-headless', 'opencode-headless']) {
    assert.ok(harnessById(id).oneShotTurn, `${id} lost its family's non-interactive turn`)
  }
})
