import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { changedSince, codeDrift, contentProbeFor, anchorProbeFor, anchorProblems, anchorVerdictCacheSize, freshnessCacheSize, staleAxes, remarkStale, type ContentProbe, type RemarkSignal } from './freshness.js'
import { scenarioCodeAxis, scenarioHash } from './scenarios.js'
import { driftIndex, withGitAbortSignal, type DriftIndex } from '../../spec-cli/src/git.js'

// The teeth ([[remark-teeth]] T1) as a pure state machine — the five transitions the CLI verification walks,
// proven here without git so the critical edge is pinned regardless of a repo's history.
const R = (ts: string) => ({ ts })
const unresolved: RemarkSignal = { resolved: false }
const resolvedAt = (at: string): RemarkSignal => ({ resolved: true, resolvedAt: at })

test('remarkStale: no remarks → clean', () => {
  assert.equal(remarkStale(R('2026-07-03T10:00:00Z'), []), false)
})

test('remarkStale: an unresolved remark ages the scenario, whatever the reading time', () => {
  assert.equal(remarkStale(R('2026-07-03T10:00:00Z'), [unresolved]), true)
  assert.equal(remarkStale(R('2030-01-01T00:00:00Z'), [unresolved]), true)   // re-running later doesn't clear it
})

test('remarkStale: resolved but the reading PRE-dates the resolution → still stale (can\'t out-run it)', () => {
  // reading filed before the resolve — the eval-before-resolve that must not count.
  assert.equal(remarkStale(R('2026-07-03T10:00:00Z'), [resolvedAt('2026-07-03T11:00:00Z')]), true)
  // reading exactly at the resolution instant does NOT post-date it (strict >) → stale.
  assert.equal(remarkStale(R('2026-07-03T11:00:00Z'), [resolvedAt('2026-07-03T11:00:00Z')]), true)
})

test('remarkStale: resolved AND the reading post-dates the resolution → clean', () => {
  assert.equal(remarkStale(R('2026-07-03T12:00:00Z'), [resolvedAt('2026-07-03T11:00:00Z')]), false)
})

test('remarkStale: many remarks — ANY not-yet-cleared one keeps it stale', () => {
  const reading = R('2026-07-03T12:00:00Z')
  assert.equal(remarkStale(reading, [resolvedAt('2026-07-03T11:00:00Z'), resolvedAt('2026-07-03T11:30:00Z')]), false)
  assert.equal(remarkStale(reading, [resolvedAt('2026-07-03T11:00:00Z'), unresolved]), true)
  assert.equal(remarkStale(reading, [resolvedAt('2026-07-03T11:00:00Z'), resolvedAt('2026-07-03T13:00:00Z')]), true)
})

test('remarkStale: a resolved bit with no timestamp stays conservatively stale', () => {
  assert.equal(remarkStale(R('2026-07-03T12:00:00Z'), [{ resolved: true }]), true)
})

// ---- the code axis is an ancestry question, not a log-position one ----

// hand-built DAG (same shape as git.test.ts): reachability decides, never walk order.
function didx(parents: Record<string, string[]>, fileCommits: [string, string[]][]): DriftIndex {
  const ord = new Map<string, number>(), p = new Map<string, string[]>()
  let i = 0
  for (const [h, ps] of Object.entries(parents)) { ord.set(h, i++); p.set(h, ps) }
  const fileEvents = new Map(fileCommits.map(([path, commits]) =>
    [path, commits.map((commit) => ({
      commit,
      historicalPath: path,
      parents: (p.get(commit) ?? []).map((parent) => ({ commit: parent, historicalPath: path })),
    }))]))
  return { ord, parents: p, fileEvents, lineageEvents: fileEvents, lineageKeys: (path) => [path], acks: new Map(), specNodes: new Map(), anc: new Map() }
}

test('changedSince: a merged side-branch change stales a reading even when its date pre-dates the codeSha', () => {
  // reading taken at VER; f.ts changed on parallel C (back-dated), merged in M. The old pos-compare
  // read C as "older than the reading" → fresh; by ancestry C is not reachable from VER → stale.
  const i = didx({ M: ['VER', 'C'], VER: ['BASE'], C: ['BASE'], BASE: [] }, [['f.ts', ['C', 'BASE']]])
  assert.equal(changedSince(i, 'VER', 'f.ts'), true)
})

test('changedSince: only ancestors of the codeSha count as already-measured', () => {
  const i = didx({ TIP: ['B'], B: ['A'], A: ['BASE'], BASE: [] }, [['f.ts', ['A', 'BASE']]])
  assert.equal(changedSince(i, 'B', 'f.ts'), false)   // both changes are ancestors of the reading
  assert.equal(changedSince(i, 'BASE', 'f.ts'), true) // A came after that reading
})

test('changedSince: an off-history codeSha (rebased away or never merged) is conservatively stale', () => {
  const i = didx({ TIP: ['BASE'], BASE: [] }, [['f.ts', ['BASE']]])
  assert.equal(changedSince(i, 'GONE', 'f.ts'), true)
})

// ---- the off-history CONTENT fallback: trees testify when ancestry can't ----

// a hand-built probe: `diff` = the paths a settled batch found changed (null = anchor commit object gone),
// `blocks` answers scenarioDiffers, `anchorPast` = the commits the anchor's own topology walk already
// carries. Also asserts the in-history fast path NEVER consults the probe.
function probeOf(diff: Set<string> | null, scenarioDiffers = false, anchorPast?: Set<string>): ContentProbe {
  return {
    changed: (_sha, path) => (diff ? diff.has(path) : null),
    canTestify: () => diff !== null,
    scenarioDiffers: () => scenarioDiffers,
    inAnchorPast: (_sha, commit) => !!anchorPast?.has(commit),
  }
}
const throwingProbe: ContentProbe = {
  changed: () => { throw new Error('probe consulted on the in-history fast path') },
  canTestify: () => { throw new Error('probe consulted on the in-history fast path') },
  scenarioDiffers: () => { throw new Error('probe consulted on the in-history fast path') },
  inAnchorPast: () => { throw new Error('probe consulted on the in-history fast path') },
}
const READING = { scenario: 's1', codeSha: 'GONE', evaluator: 'manual@1', ts: '2026-07-09T00:00:00Z' }

test('content fallback: off-history anchor with byte-identical governed content reads FRESH', () => {
  const i = didx({ TIP: ['BASE'], BASE: [] }, [['f.ts', ['BASE']], ['y/eval.md', ['BASE']]])
  // the tree diff names only an unrelated path — governed file and eval.md are byte-identical
  const probe = probeOf(new Set(['other.txt']))
  assert.equal(changedSince(i, 'GONE', 'f.ts', probe), false)
  assert.deepEqual(staleAxes(READING, ['f.ts'], 'y/eval.md', i, new Map(), [], probe), [])
})

test('content fallback: a genuinely changed governed file still stales the code axis', () => {
  const i = didx({ TIP: ['BASE'], BASE: [] }, [['f.ts', ['BASE']]])
  const probe = probeOf(new Set(['f.ts']))
  assert.equal(changedSince(i, 'GONE', 'f.ts', probe), true)
  assert.deepEqual(staleAxes(READING, ['f.ts'], 'y/eval.md', i, new Map(), [], probe), ['code'])
})

test('content fallback: scenario axis is per-scenario — a changed eval.md stales only if THIS block moved', () => {
  const i = didx({ TIP: ['BASE'], BASE: [] }, [])
  // eval.md changed but this scenario's block did not (a sibling moved) → fresh
  assert.deepEqual(staleAxes(READING, [], 'y/eval.md', i, new Map(), [], probeOf(new Set(['y/eval.md']), false)), [])
  // this scenario's own block moved → stale
  assert.deepEqual(staleAxes(READING, [], 'y/eval.md', i, new Map(), [], probeOf(new Set(['y/eval.md']), true)), ['scenario'])
})

test('content fallback: a truly GONE anchor commit stays conservatively stale, named as the anchor axis', () => {
  const i = didx({ TIP: ['BASE'], BASE: [] }, [['f.ts', ['BASE']]])
  assert.deepEqual(staleAxes(READING, ['f.ts'], 'y/eval.md', i, new Map(), [], probeOf(null)), ['anchor'])
  // without a probe the old conservative rule holds unchanged
  assert.deepEqual(staleAxes(READING, ['f.ts'], 'y/eval.md', i, new Map(), []), ['code', 'scenario'])
})

test('content fallback: the in-history fast path never consults the probe', () => {
  const i = didx({ TIP: ['B'], B: ['A'], A: ['BASE'], BASE: [] }, [['f.ts', ['A', 'BASE']], ['y/eval.md', ['BASE']]])
  assert.equal(changedSince(i, 'B', 'f.ts', throwingProbe), false)
  assert.deepEqual(staleAxes({ ...READING, codeSha: 'B' }, ['f.ts'], 'y/eval.md', i, new Map([['y/eval.md', new Map()]]), [], throwingProbe), [])
})

test('codeDrift: off-history fallback reports only content-changed files, counting against the ANCHOR\'s past', () => {
  const i = didx({ TIP: ['MID'], MID: ['BASE'], BASE: [] }, [['a.ts', ['TIP', 'MID', 'BASE']], ['b.ts', ['BASE']]])
  // the anchor's own past already carries two of a.ts's three touches → one commit of drift is left, the
  // same subtraction the in-history branch makes with HEAD's ancestry
  assert.deepEqual(codeDrift(i, 'GONE', ['a.ts', 'b.ts'], probeOf(new Set(['a.ts']), false, new Set(['BASE', 'MID']))), [{ file: 'a.ts', behind: 1 }])
  // the anchor's past covers every touch, yet the trees demonstrably differ → floored at one, never zero
  assert.deepEqual(codeDrift(i, 'GONE', ['a.ts'], probeOf(new Set(['a.ts']), false, new Set(['TIP', 'MID', 'BASE']))), [{ file: 'a.ts', behind: 1 }])
  // the anchor's topology can't testify → every touch counts, conservatively
  assert.deepEqual(codeDrift(i, 'GONE', ['a.ts'], probeOf(new Set(['a.ts']))), [{ file: 'a.ts', behind: 3 }])
  // no probe → the old conservative every-touch count
  assert.deepEqual(codeDrift(i, 'GONE', ['a.ts', 'b.ts']), [{ file: 'a.ts', behind: 3 }, { file: 'b.ts', behind: 1 }])
})

// ---- the stored-contract-hash scenario axis (#61): pure text compare, one track per reading ----

const SC = (description: string, expected: string) => ({ name: 's1', description, expected })
const HASHED = { ...READING, codeSha: 'B', scenarioHash: scenarioHash(SC('measure it', 'it behaves')) }

test('hash axis: a matching current declaration reads FRESH even when the git chain claims a non-ancestor change (#61 merge shape)', () => {
  const i = didx({ TIP: ['B', 'C'], B: ['BASE'], C: ['BASE'], BASE: [] }, [])
  // the linearized-chain bug: a sibling branch's commit C got misattributed to s1 — with the stored
  // hash the git chain is not consulted at all, so the cross-branch misattribution cannot re-stale it.
  const scidx = new Map([['y/eval.md', new Map([['s1', ['C']]])]])
  assert.deepEqual(staleAxes(HASHED, [], 'y/eval.md', i, scidx, [], undefined, SC('measure it', 'it behaves')), [])
})

test('hash axis: whitespace churn (re-wrap, CRLF, indent) never moves the hash; a semantic edit does', () => {
  const i = didx({ TIP: ['B'], B: ['BASE'], BASE: [] }, [])
  const scidx = new Map()
  assert.deepEqual(staleAxes(HASHED, [], 'y/eval.md', i, scidx, [], undefined, SC('measure\r\n   it', ' it\tbehaves ')), [])
  assert.deepEqual(staleAxes(HASHED, [], 'y/eval.md', i, scidx, [], undefined, SC('measure it', 'it behaves BETTER')), ['scenario'])
})

test('hash axis: the scenario gone from eval.md → stale (nothing current to compare against)', () => {
  const i = didx({ TIP: ['B'], B: ['BASE'], BASE: [] }, [])
  assert.deepEqual(staleAxes(HASHED, [], 'y/eval.md', i, new Map(), [], undefined, undefined), ['scenario'])
})

test('hash axis: a LEGACY reading (no hash) is decided by the git rule alone — the one-shot degradation', () => {
  const i = didx({ TIP: ['B', 'C'], B: ['BASE'], C: ['BASE'], BASE: [] }, [])
  const scidx = new Map([['y/eval.md', new Map([['s1', ['C']]])]])
  const legacy = { ...READING, codeSha: 'B' }
  // same DAG, same chain, same CURRENT declaration — but no stored hash → the git rule decides (stale),
  // and the matching current text does NOT rescue it (no dual-track OR).
  assert.deepEqual(staleAxes(legacy, [], 'y/eval.md', i, scidx, [], undefined, SC('measure it', 'it behaves')), ['scenario'])
  // and with a clean chain the legacy rule still reads fresh, exactly as before
  assert.deepEqual(staleAxes(legacy, [], 'y/eval.md', i, new Map([['y/eval.md', new Map()]]), [], undefined, SC('anything', 'else')), [])
})

test('hash axis: the stored hash testifies even when the anchor commit is pruned', () => {
  const i = didx({ TIP: ['BASE'], BASE: [] }, [])
  const gone = { ...HASHED, codeSha: 'GONE' }
  // anchor object gone (probe null): code axis can only say "anchor", but the hash still decides scenario
  assert.deepEqual(staleAxes(gone, ['f.ts'], 'y/eval.md', i, new Map(), [], probeOf(null), SC('measure it', 'it behaves')), ['anchor'])
  assert.deepEqual(staleAxes(gone, ['f.ts'], 'y/eval.md', i, new Map(), [], probeOf(null), SC('changed', 'contract')), ['anchor', 'scenario'])
})

// ---- the off-history pathspec batch: real children, union-before-spawn, and per-path retention ----

const REAL_GIT = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
function sh(root: string, args: string[]): string {
  return execFileSync(REAL_GIT, args, { cwd: root, encoding: 'utf8' }).trim()
}
function schedulerRepo(commits: number): { root: string; hashes: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'freshness-scheduler-'))
  sh(root, ['init', '-q', '-b', 'main'])
  sh(root, ['config', 'user.email', 't@t'])
  sh(root, ['config', 'user.name', 't'])
  const hashes: string[] = []
  for (let i = 0; i < commits; i++) {
    writeFileSync(join(root, 'tracked.txt'), `${i}\n`)
    writeFileSync(join(root, 'stable.txt'), 'never moves\n')
    sh(root, ['add', '-A'])
    sh(root, ['commit', '-q', '-m', `c${i}`])
    hashes.push(sh(root, ['rev-parse', 'HEAD']))
  }
  return { root, hashes }
}
// every shape a governed path can take at an off-history anchor: ordinary edit, glob metacharacters, a
// space, a deletion, a mode-only change, an untouched file — plus one changed file nobody asks about.
const FIXTURE_CHANGED = ['tracked.txt', 'weird [x]*.md', 'dir with space/a b.txt', 'gone.txt', 'script.sh']
const FIXTURE_REQUESTED = [...FIXTURE_CHANGED, 'stable.txt']
function fixtureRepo(): { root: string; anchor: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'freshness-fixture-'))
  sh(root, ['init', '-q', '-b', 'main'])
  sh(root, ['config', 'user.email', 't@t'])
  sh(root, ['config', 'user.name', 't'])
  const write = (rel: string, body: string) => {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  for (const rel of [...FIXTURE_REQUESTED, 'unrequested.txt']) write(rel, 'base\n')
  sh(root, ['add', '-A'])
  sh(root, ['commit', '-q', '-m', 'base'])
  const anchor = sh(root, ['rev-parse', 'HEAD'])
  for (const rel of ['tracked.txt', 'weird [x]*.md', 'dir with space/a b.txt', 'unrequested.txt']) write(rel, 'moved\n')
  rmSync(join(root, 'gone.txt'))
  chmodSync(join(root, 'script.sh'), 0o755)
  sh(root, ['add', '-A'])
  sh(root, ['commit', '-q', '-m', 'head'])
  return { root, anchor, head: sh(root, ['rev-parse', 'HEAD']) }
}
// the reference answer: an UNSCOPED tree diff, the exact question the probe used to ask repo-wide
function fullDiff(root: string, anchor: string, head: string): Set<string> {
  return new Set(sh(root, ['diff', '--name-only', '-z', '--no-renames', anchor, head]).split('\0').filter(Boolean))
}
type TraceEvent = { event: 'start' | 'end'; pid: string; argv: string; input: string[] }
function diffTrace(delay = '0.03') {
  const bin = mkdtempSync(join(tmpdir(), 'freshness-git-bin-'))
  const log = join(bin, 'events.log')
  const hang = join(bin, 'hang')
  const shim = join(bin, 'git')
  writeFileSync(log, '')
  writeFileSync(shim, `#!${process.execPath}
const fs = require('node:fs')
const cp = require('node:child_process')
const args = process.argv.slice(2)
const input = fs.readFileSync(0)
const watched = args.includes('diff-tree') && args.includes('--stdin') && args.includes('--always')
const write = (event) => fs.appendFileSync(process.env.SPEX_TEST_DIFF_LOG,
  JSON.stringify({ event, pid: String(process.pid), argv: args.join(' '), input: input.toString('utf8').split('\\n').filter(Boolean) }) + '\\n')
if (watched) {
  write('start')
  const starts = fs.readFileSync(process.env.SPEX_TEST_DIFF_LOG, 'utf8').split('\\n')
    .filter(Boolean).map((line) => JSON.parse(line)).filter((row) => row.event === 'start').length
  if (Number(process.env.SPEX_TEST_DIFF_FAIL_AT) === starts) {
    process.stderr.write('controlled content chunk failure\\n')
    process.exit(73)
  }
  while (process.env.SPEX_TEST_DIFF_HANG && fs.existsSync(process.env.SPEX_TEST_DIFF_HANG))
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  if (process.env.SPEX_TEST_DIFF_DELAY)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.SPEX_TEST_DIFF_DELAY) * 1000)
}
const result = cp.spawnSync(process.env.SPEX_TEST_REAL_GIT, args, { input, maxBuffer: 64 * 1024 * 1024 })
if (watched) write('end')
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
if (result.error) throw result.error
process.exit(result.status ?? 1)
`)
  chmodSync(shim, 0o755)
  const previous = {
    PATH: process.env.PATH,
    log: process.env.SPEX_TEST_DIFF_LOG,
    hang: process.env.SPEX_TEST_DIFF_HANG,
    delay: process.env.SPEX_TEST_DIFF_DELAY,
    real: process.env.SPEX_TEST_REAL_GIT,
  }
  process.env.PATH = `${bin}:${process.env.PATH ?? ''}`
  process.env.SPEX_TEST_DIFF_LOG = log
  process.env.SPEX_TEST_DIFF_HANG = hang
  process.env.SPEX_TEST_DIFF_DELAY = delay
  process.env.SPEX_TEST_REAL_GIT = REAL_GIT
  const restore = () => {
    for (const [key, value] of Object.entries({
      PATH: previous.PATH,
      SPEX_TEST_DIFF_LOG: previous.log,
      SPEX_TEST_DIFF_HANG: previous.hang,
      SPEX_TEST_DIFF_DELAY: previous.delay,
      SPEX_TEST_REAL_GIT: previous.real,
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  const events = (): TraceEvent[] => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
    .map((line) => JSON.parse(line) as TraceEvent)
  return { bin, log, hang, shim, events, restore }
}
function peakActive(events: TraceEvent[]): { peak: number; final: number } {
  let active = 0, peak = 0
  for (const event of events) {
    active += event.event === 'start' ? 1 : -1
    peak = Math.max(peak, active)
  }
  return { peak, final: active }
}
async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`condition not reached within ${timeoutMs}ms`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('content batch: 9 concurrent probes for one anchor spawn exactly one child, and a settled path is never re-asked', async () => {
  const { root, hashes } = schedulerRepo(2)
  const trace = diffTrace()
  try {
    const probes = Array.from({ length: 9 }, () => contentProbeFor(root))
    await Promise.all(probes.map((probe) => probe.prime!(hashes[0], ['tracked.txt'], 'absent-eval.md')))
    assert.equal(trace.events().filter((event) => event.event === 'start').length, 1)
    assert.ok(probes.every((probe) => probe.changed(hashes[0], 'tracked.txt') === true))
    await probes[0].prime!(hashes[0], ['tracked.txt'], 'absent-eval.md')
    assert.equal(trace.events().filter((event) => event.event === 'start').length, 1, 'settled verdicts serve the repeat')
  } finally {
    trace.restore()
  }
})

test('content batch: concurrent probes asking DISJOINT paths union into one child that answers both', async () => {
  const { root, hashes } = schedulerRepo(2)
  const trace = diffTrace('0.05')
  try {
    const first = contentProbeFor(root)
    const second = contentProbeFor(root)
    await Promise.all([
      first.prime!(hashes[0], ['tracked.txt'], 'absent-eval.md'),
      second.prime!(hashes[0], ['stable.txt'], 'other-eval.md'),
    ])
    const starts = trace.events().filter((event) => event.event === 'start')
    assert.equal(starts.length, 1, 'both callers registered before the permit landed, so one child covers both')
    for (const path of ['tracked.txt', 'stable.txt', 'absent-eval.md', 'other-eval.md'])
      assert.ok(starts[0].argv.includes(`:(literal)${path}`), `${path} rode the union batch`)
    assert.equal(first.changed(hashes[0], 'tracked.txt'), true)
    assert.equal(second.changed(hashes[0], 'stable.txt'), false)
  } finally {
    trace.restore()
  }
})

// @@@ the drift COUNT is a reachability question, not a per-pair history walk - `rev-list --count
// <anchor>..<HEAD> -- <path>` names an OFF-HISTORY range, so Git cannot cut the walk short: every pair
// traverses the whole history. Measured cold on a 437-anchor z-code scope, 96.5% of the read's git-child
// samples were those counts and `/api/graph` took 96.3s against a 1.5s budget. The anchors' own ancestry is
// the only thing HEAD's index lacks, and ONE topology walk carries it for the whole roster; concurrent
// probes join that walk exactly as they already join the content batch.
function driftCountRepo(anchors: number): { root: string; anchorShas: string[]; paths: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'freshness-driftcount-'))
  sh(root, ['init', '-q', '-b', 'main'])
  sh(root, ['config', 'user.email', 't@t'])
  sh(root, ['config', 'user.name', 't'])
  const write = (rel: string, body: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  const commit = (message: string) => { sh(root, ['add', '-A']); sh(root, ['commit', '-q', '-m', message]) }
  const paths = ['a.ts', 'dir with space/b.ts', ':colon.ts', 'anchor-only.ts']
  for (const path of [...paths, 'eval.md']) write(path, 'base\n')
  commit('base')
  // the anchors: a branch the current HEAD cannot reach — an unmerged branch and a rewritten history read
  // the same way here, which is the whole point of the content fallback.
  sh(root, ['checkout', '-q', '-b', 'anchors'])
  const anchorShas: string[] = []
  for (let index = 0; index < anchors; index++) {
    write('a.ts', `anchor ${index}\n`)
    write('anchor-only.ts', `anchor ${index}\n`)
    commit(`anchor ${index}`)
    anchorShas.push(sh(root, ['rev-parse', 'HEAD']))
  }
  sh(root, ['checkout', '-q', 'main'])
  write('a.ts', 'main one\n'); commit('main moves a')
  write('a.ts', 'main two\n'); write('dir with space/b.ts', 'main two\n'); commit('main moves a and the spaced path')
  write(':colon.ts', 'main three\n'); commit('main moves the colon path')
  return { root, anchorShas, paths }
}
type RevListCensus = { counts: string[]; topology: string[] }
function revListTrace(): { census: () => RevListCensus; restore: () => void } {
  const bin = mkdtempSync(join(tmpdir(), 'freshness-revlist-bin-'))
  const log = join(bin, 'calls.log')
  writeFileSync(log, '')
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${REAL_GIT}' "$@"\n`)
  chmodSync(join(bin, 'git'), 0o755)
  const savedPath = process.env.PATH
  process.env.PATH = `${bin}:${savedPath ?? ''}`
  const rows = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).filter((row) => row.includes('rev-list'))
  return {
    census: () => ({
      counts: rows().filter((row) => row.includes('--count')),
      topology: rows().filter((row) => row.includes('--parents') && row.includes('--stdin')),
    }),
    restore: () => { if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath },
  }
}

test('content batch: concurrent probes join ONE topology walk for the drift count, not one range count each', async () => {
  const { root, anchorShas, paths } = driftCountRepo(1)
  const idx = await driftIndex(root)
  const trace = revListTrace()
  try {
    const first = contentProbeFor(root)
    const second = contentProbeFor(root)
    await Promise.all([
      first.prime!(anchorShas[0], paths, 'eval.md'),
      second.prime!(anchorShas[0], paths, 'eval.md'),
    ])
    const census = trace.census()
    assert.equal(census.counts.length, 0, `no per-pair range count may fork, ${census.counts.length} did`)
    assert.equal(census.topology.length, 1, `both probes must join one topology walk, forked ${census.topology.length}`)
    for (const probe of [first, second])
      assert.deepEqual(codeDrift(idx, anchorShas[0], ['a.ts'], probe), [{ file: 'a.ts', behind: 2 }],
        'the joined walk is the real answer, not a default')
  } finally { trace.restore(); rmSync(root, { recursive: true, force: true }) }
})

test('off-history drift counts: ONE topology walk for the whole read, never one rev-list per (anchor, path)', async () => {
  const { root, anchorShas, paths } = driftCountRepo(12)
  const idx = await driftIndex(root)
  const trace = revListTrace()
  try {
    const probe = contentProbeFor(root)
    const demands = anchorShas.map((anchorSha) => ({ anchorSha, paths, evalPath: 'eval.md' }))
    await probe.primeMany!(demands)
    const census = trace.census()
    assert.equal(census.counts.length, 0, `no per-pair range count may fork, ${census.counts.length} did`)
    assert.equal(census.topology.length, 1, `one walk answers all twelve anchors, forked ${census.topology.length}`)
    assert.ok(census.topology[0].length < 400, `the roster rides stdin, not argv: ${census.topology[0]}`)
    for (const anchorSha of anchorShas) assert.deepEqual(codeDrift(idx, anchorSha, paths, probe), [
      { file: 'a.ts', behind: 2 },
      { file: 'dir with space/b.ts', behind: 1 },
      { file: ':colon.ts', behind: 1 },          // a leading colon is a path here, never pathspec magic
      { file: 'anchor-only.ts', behind: 1 },     // only the anchor's own side moved it → floored at 1
    ], `anchor ${anchorSha} drift detail`)
    await probe.primeMany!(demands)
    assert.deepEqual(trace.census(), census, 'the unchanged repeat walks nothing again')
  } finally { trace.restore(); rmSync(root, { recursive: true, force: true }) }
})


test('content batch: a path requested mid-flight rides the NEXT batch, never the running child', async () => {
  const { root, hashes } = schedulerRepo(2)
  const trace = diffTrace('0.3')
  try {
    const probe = contentProbeFor(root)
    const running = probe.prime!(hashes[0], ['tracked.txt'], 'absent-eval.md')
    await waitFor(() => trace.events().some((event) => event.event === 'start'))
    const late = contentProbeFor(root).prime!(hashes[0], ['stable.txt'], 'absent-eval.md')
    await Promise.all([running, late])
    const starts = trace.events().filter((event) => event.event === 'start')
    assert.equal(starts.length, 2, 'the late path could not join a child already spawned')
    assert.ok(!starts[0].argv.includes(':(literal)stable.txt'))
    assert.ok(starts[1].argv.includes(':(literal)stable.txt'))
    assert.ok(!starts[1].argv.includes(':(literal)tracked.txt'), 'the settled path is not re-asked in the next batch')
    assert.equal(probe.changed(hashes[0], 'stable.txt'), false)
  } finally {
    trace.restore()
  }
})

test('content batch: verdicts equal an unscoped tree diff for every requested path — globs, spaces, deletion, mode-only', async () => {
  const { root, anchor, head } = fixtureRepo()
  const expected = fullDiff(root, anchor, head)
  const probe = contentProbeFor(root)
  await probe.prime!(anchor, FIXTURE_REQUESTED, 'absent-eval.md')
  for (const path of FIXTURE_REQUESTED)
    assert.equal(probe.changed(anchor, path), expected.has(path), `${path} matches the full diff`)
  assert.deepEqual(FIXTURE_CHANGED.filter((p) => expected.has(p)), FIXTURE_CHANGED, 'the fixture really moved all five shapes')
  assert.equal(expected.has('stable.txt'), false)
  assert.equal(probe.canTestify(anchor), true)
})

test('content batch: a path nobody requested stays unprovable — no whole-repo path set is retained', async () => {
  const { root, anchor, head } = fixtureRepo()
  const probe = contentProbeFor(root)
  await probe.prime!(anchor, ['tracked.txt'], 'absent-eval.md')
  assert.equal(fullDiff(root, anchor, head).has('unrequested.txt'), true, 'it really did change repo-wide')
  assert.equal(probe.changed(anchor, 'unrequested.txt'), null, 'yet the probe holds no verdict for it')
  assert.equal(probe.changed(anchor, 'tracked.txt'), true)
})

test('content batch: 14 unique anchors in one population use one object check and one content child', async () => {
  const { root, hashes } = schedulerRepo(15)
  const trace = diffTrace()
  try {
    const probe = contentProbeFor(root)
    await probe.primeMany!(hashes.slice(0, 14).map((anchorSha) => ({
      anchorSha, paths: ['tracked.txt'], evalPath: 'absent-eval.md',
    })))
    const events = trace.events()
    const starts = events.filter((event) => event.event === 'start')
    assert.equal(starts.length, 1)
    assert.equal(starts[0].input.length, 14, 'the single child receives every resolved anchor/HEAD pair')
    assert.deepEqual(peakActive(events), { peak: 1, final: 0 })
    assert.ok(hashes.slice(0, 14).every((sha) => probe.changed(sha, 'tracked.txt') === true))
  } finally {
    trace.restore()
  }
})

test('content batch: replacement and graft changes rotate both anchor and current image interpretations', async () => {
  const { root, hashes } = schedulerRepo(3)
  const trace = diffTrace('0')
  const anchor = hashes[1], current = hashes[2]
  const probe = contentProbeFor(root)
  const replacement = (tree: string, message: string) => sh(root, ['commit-tree', tree, '-m', message])
  try {
    await probe.prime!(anchor, ['tracked.txt'], 'absent-eval.md')
    assert.equal(probe.changed(anchor, 'tracked.txt'), true)

    sh(root, ['replace', '--graft', anchor])
    await probe.prime!(anchor, ['tracked.txt'], 'absent-eval.md')
    assert.equal(probe.changed(anchor, 'tracked.txt'), true, 'a graft changes ancestry interpretation, not this tree verdict')
    sh(root, ['replace', '-d', anchor])

    const anchorAsCurrent = replacement(`${current}^{tree}`, 'anchor replacement carries current tree')
    sh(root, ['replace', anchor, anchorAsCurrent])
    await probe.prime!(anchor, ['tracked.txt'], 'absent-eval.md')
    assert.equal(probe.changed(anchor, 'tracked.txt'), false, 'the same raw anchor is re-read through its replacement image')
    sh(root, ['replace', '-d', anchor])

    const currentAsAnchor = replacement(`${anchor}^{tree}`, 'current replacement carries anchor tree')
    sh(root, ['replace', current, currentAsAnchor])
    await probe.prime!(anchor, ['tracked.txt'], 'absent-eval.md')
    assert.equal(probe.changed(anchor, 'tracked.txt'), false, 'the same raw HEAD is re-read through its replacement image')
    sh(root, ['replace', '-d', current])

    await probe.prime!(anchor, ['tracked.txt'], 'absent-eval.md')
    assert.equal(probe.changed(anchor, 'tracked.txt'), true, 'removing replacement refs restores the original images')
    assert.equal(trace.events().filter((event) => event.event === 'start').length, 5,
      'every interpretation move recomputed once; no raw-SHA verdict was reused')
  } finally {
    trace.restore()
    rmSync(trace.bin, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('content batch: abort removes active and queued flights, then both retry without a ghost spawn', async () => {
  const { root, hashes } = schedulerRepo(3)
  const trace = diffTrace('0')
  writeFileSync(trace.hang, '')
  try {
    const controller = new AbortController()
    const results = await withGitAbortSignal(controller.signal, async () => {
      const active = contentProbeFor(root).prime!(hashes[0], ['tracked.txt'], 'absent-eval.md')
      await waitFor(() => trace.events().some((event) => event.event === 'start'))
      const queued = contentProbeFor(root).prime!(hashes[1], ['tracked.txt'], 'absent-eval.md')
      controller.abort()
      return Promise.allSettled([active, queued])
    })
    assert.ok(results.every((result) => result.status === 'rejected' && result.reason?.name === 'AbortError'))
    assert.equal(trace.events().filter((event) => event.event === 'start').length, 1, 'queued abort never spawns')

    rmSync(trace.hang)
    const retried = [contentProbeFor(root), contentProbeFor(root)]
    await Promise.all([
      retried[0].prime!(hashes[0], ['tracked.txt'], 'absent-eval.md'),
      retried[1].prime!(hashes[1], ['tracked.txt'], 'absent-eval.md'),
    ])
    assert.equal(trace.events().filter((event) => event.event === 'start').length, 3,
      'active and queued failures both leave retryable flights and no ghost waiter')
    assert.equal(retried[0].changed(hashes[0], 'tracked.txt'), true, 'the aborted verdict was never cached, so the retry settles it')
  } finally {
    trace.restore()
  }
})

test('content batch: one over-limit long-path anchor splits, and a later chunk failure publishes nothing', async () => {
  const { root, hashes } = schedulerRepo(2)
  const trace = diffTrace('0')
  const previous = process.env.SPEX_TEST_DIFF_FAIL_AT
  process.env.SPEX_TEST_DIFF_FAIL_AT = '2'
  const paths = Array.from({ length: 8_300 }, (_, index) =>
    `long/${String(index).padStart(5, '0')}-${'x'.repeat(80)}.txt`)
  const demand = { anchorSha: hashes[0], paths, evalPath: 'absent-eval.md' }
  try {
    const probe = contentProbeFor(root)
    await assert.rejects(probe.primeMany!([demand]), /git content diff batch failed \(exit\): controlled content chunk failure/)
    assert.equal(probe.canTestify(hashes[0]), false, 'the successful first slice did not leak a partial verdict')
    delete process.env.SPEX_TEST_DIFF_FAIL_AT
    await probe.primeMany!([demand])
    const starts = trace.events().filter((event) => event.event === 'start')
    assert.ok(starts.length > 4, `the single row really split into several chunks: ${starts.length}`)
    assert.ok(starts.every((event) => event.input.length === 1), 'every slice carries the one exact anchor/current pair')
    assert.ok(starts.every((event) => Buffer.byteLength(event.argv) + 1 <= 16 * 1_024), 'every child stays inside the argv byte bound')
    assert.ok(paths.every((path) => probe.changed(hashes[0], path) === false))
  } finally {
    if (previous === undefined) delete process.env.SPEX_TEST_DIFF_FAIL_AT
    else process.env.SPEX_TEST_DIFF_FAIL_AT = previous
    trace.restore()
    rmSync(trace.bin, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('content batch: equal SHA keys in two roots neither coalesce nor serialize each other', async () => {
  const first = schedulerRepo(2)
  const secondRoot = mkdtempSync(join(tmpdir(), 'freshness-scheduler-clone-'))
  execFileSync(REAL_GIT, ['clone', '-q', first.root, secondRoot])
  const trace = diffTrace('0.1')
  try {
    const probes = [contentProbeFor(first.root), contentProbeFor(secondRoot)]
    await Promise.all([
      probes[0].prime!(first.hashes[0], ['tracked.txt'], 'absent-eval.md'),
      probes[1].prime!(first.hashes[0], ['tracked.txt'], 'absent-eval.md'),
    ])
    const events = trace.events()
    assert.equal(events.filter((event) => event.event === 'start').length, 2)
    assert.equal(events.filter((event) => event.event === 'start' && event.argv.includes(`-C ${first.root} `)).length, 1)
    assert.equal(events.filter((event) => event.event === 'start' && event.argv.includes(`-C ${secondRoot} `)).length, 1)
    assert.equal(peakActive(events).peak, 2, 'independent roots own independent batch scopes')
    assert.ok(probes.every((probe) => probe.changed(first.hashes[0], 'tracked.txt') === true), 'each root answered from its own verdicts')
  } finally {
    trace.restore()
  }
})

test('content batch: moving HEAD creates a new scope and query, and the released head is no longer readable', async () => {
  const { root, hashes } = schedulerRepo(2)
  const trace = diffTrace()
  try {
    const before = contentProbeFor(root)
    await before.prime!(hashes[0], ['after-head-move.txt'], 'absent-eval.md')
    writeFileSync(join(root, 'after-head-move.txt'), 'new\n')
    sh(root, ['add', 'after-head-move.txt'])
    sh(root, ['commit', '-q', '-m', 'move head'])
    const after = contentProbeFor(root)
    await after.prime!(hashes[0], ['after-head-move.txt'], 'absent-eval.md')
    assert.equal(trace.events().filter((event) => event.event === 'start').length, 2)
    assert.equal(before.changed(hashes[0], 'after-head-move.txt'), null, 'the released head cannot answer')
    assert.equal(after.changed(hashes[0], 'after-head-move.txt'), true, 'the new head sees the content that moved')
  } finally {
    trace.restore()
  }
})

test('content batch: spawn failure is loud, not memoized, and a repaired child path retries', async () => {
  const { root, hashes } = schedulerRepo(2)
  const trace = diffTrace()
  try {
    process.env.PATH = trace.bin
    chmodSync(trace.shim, 0o644)
    await assert.rejects(contentProbeFor(root).prime!(hashes[0], ['tracked.txt'], 'absent-eval.md'),
      /git executable not found on PATH/)
    assert.equal(contentProbeFor(root).canTestify(hashes[0]), false, 'a failed batch settles nothing')
    chmodSync(trace.shim, 0o755)
    const retry = contentProbeFor(root)
    await retry.prime!(hashes[0], ['tracked.txt'], 'absent-eval.md')
    assert.equal(trace.events().filter((event) => event.event === 'start').length, 1)
    assert.equal(retry.changed(hashes[0], 'tracked.txt'), true)
  } finally {
    trace.restore()
  }
})

test('content batch: an unreadable anchor object is the anchor axis, not a content verdict', async () => {
  const { root } = schedulerRepo(2)
  const probe = contentProbeFor(root)
  await probe.prime!('d'.repeat(40), ['tracked.txt'], 'absent-eval.md')
  assert.equal(probe.canTestify('d'.repeat(40)), false, 'content cannot testify for a gone anchor')
  assert.equal(probe.changed('d'.repeat(40), 'tracked.txt'), null)
})

test('content batch: a previously missing anchor becomes testifyable after its object arrives', async () => {
  const { root } = schedulerRepo(2)
  const source = mkdtempSync(join(tmpdir(), 'freshness-missing-source-'))
  execFileSync(REAL_GIT, ['clone', '-q', root, source])
  try {
    sh(source, ['config', 'user.email', 't@t'])
    sh(source, ['config', 'user.name', 't'])
    writeFileSync(join(source, 'tracked.txt'), 'arrived later\n')
    sh(source, ['commit', '-qam', 'available later'])
    const anchor = sh(source, ['rev-parse', 'HEAD'])
    const probe = contentProbeFor(root)
    await probe.prime!(anchor, ['tracked.txt'], 'absent-eval.md')
    assert.equal(probe.canTestify(anchor), false)
    sh(root, ['fetch', '-q', source, anchor])
    await probe.prime!(anchor, ['tracked.txt'], 'absent-eval.md')
    assert.equal(probe.canTestify(anchor), true, 'gone is retried rather than cached as permanent absence')
    assert.equal(probe.changed(anchor, 'tracked.txt'), true)
  } finally {
    rmSync(source, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('content batch: SHA-256 repositories use their native resolved image width', async () => {
  const root = mkdtempSync(join(tmpdir(), 'freshness-sha256-'))
  try {
    sh(root, ['init', '-q', '--object-format=sha256', '-b', 'main'])
    sh(root, ['config', 'user.email', 't@t'])
    sh(root, ['config', 'user.name', 't'])
    writeFileSync(join(root, 'tracked.txt'), 'base\n')
    sh(root, ['add', '.']); sh(root, ['commit', '-qm', 'base'])
    const anchor = sh(root, ['rev-parse', 'HEAD'])
    writeFileSync(join(root, 'tracked.txt'), 'head\n')
    sh(root, ['commit', '-qam', 'head'])
    const probe = contentProbeFor(root)
    await probe.prime!(anchor, ['tracked.txt'], 'absent-eval.md')
    assert.equal(anchor.length, 64)
    assert.equal(probe.changed(anchor, 'tracked.txt'), true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ---- per-root current-head scope: a rebuild must not leave the previous head's verdicts resident ----

test('content batch: a head move swaps the scope — one generation resident, and the old head stops answering', async () => {
  const { root, hashes } = schedulerRepo(2)
  const trace = diffTrace()
  try {
    const before = contentProbeFor(root)
    await before.prime!(hashes[0], ['tracked.txt'], 'absent-eval.md')
    assert.equal(before.changed(hashes[0], 'tracked.txt'), true)
    assert.equal(freshnessCacheSize(root), 1)

    sh(root, ['commit', '--allow-empty', '-qm', 'move head'])
    const after = contentProbeFor(root)          // a probe at the NEW head claims the root's scope
    await after.prime!(hashes[0], ['tracked.txt'], 'absent-eval.md')

    assert.equal(after.changed(hashes[0], 'tracked.txt'), true)
    assert.equal(before.changed(hashes[0], 'tracked.txt'), null, 'the superseded head no longer answers')
    assert.equal(before.canTestify(hashes[0]), false)
    assert.equal(freshnessCacheSize(root), 1, 'the previous head kept a second generation resident')
    assert.equal(trace.events().filter((e) => e.event === 'start').length, 2, 'the new head asks its own question')
  } finally {
    trace.restore()
  }
})

test('content batch: a batch still in flight when the head moves settles for its caller and never backfills the new head', async () => {
  const { root, hashes } = schedulerRepo(2)
  const trace = diffTrace('0.3')
  try {
    const stale = contentProbeFor(root)
    const inFlight = stale.prime!(hashes[0], ['tracked.txt'], 'absent-eval.md')
    await waitFor(() => trace.events().some((e) => e.event === 'start'))
    sh(root, ['commit', '--allow-empty', '-qm', 'move head mid-flight'])
    const fresh = contentProbeFor(root)
    const freshPrime = fresh.prime!(hashes[0], ['tracked.txt'], 'absent-eval.md')   // swaps mid-flight

    await inFlight                                   // the holder settles rather than hanging or throwing
    await freshPrime
    assert.equal(stale.changed(hashes[0], 'tracked.txt'), null, 'a superseded head answers nothing')
    assert.equal(fresh.changed(hashes[0], 'tracked.txt'), true, 'the new head answers from its own batch')
    assert.equal(freshnessCacheSize(root), 1, 'the detached in-flight entry stayed out of the current scope')
  } finally {
    trace.restore()
  }
})

test('content batch: three rebuilds over the same anchors hold one generation, not three', async () => {
  const { root, hashes } = schedulerRepo(2)
  const anchors = [hashes[0], hashes[1]]
  const sizes: number[] = []
  for (let round = 0; round < 3; round++) {
    if (round > 0) sh(root, ['commit', '--allow-empty', '-qm', `round ${round}`])
    const probe = contentProbeFor(root)
    for (const anchor of anchors) await probe.prime!(anchor, ['tracked.txt', 'stable.txt'], 'absent-eval.md')
    sizes.push(freshnessCacheSize(root))
  }
  assert.deepEqual(sizes, [sizes[0], sizes[0], sizes[0]],
    `cardinality grew with rebuild count instead of staying at the corpus: ${sizes.join(' -> ')}`)
  assert.equal(sizes[0], anchors.length, 'one entry per anchor at the current head')
})

// ---- the scenario code axis narrows to named units ([[eval-core]] / [[code-anchor]]) ----

// A real git repo carrying ONE module with two independently-measured units — the shape of the corpus this
// exists for: harness.ts holds eight adapters, so an edit to one must not stale the readings of the others.
// typescript is linked in because ts-ast parses through the GOVERNED repository's own compiler.
function anchorRepo(): { root: string; base: string } {
  const root = mkdtempSync(join(tmpdir(), 'freshness-anchor-'))
  sh(root, ['init', '-q', '-b', 'main'])
  sh(root, ['config', 'user.email', 't@t'])
  sh(root, ['config', 'user.name', 't'])
  writeFileSync(join(root, 'package.json'), '{"name":"fx","private":true}\n')
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  symlinkSync(dirname(createRequire(import.meta.url).resolve('typescript/package.json')), join(root, 'node_modules', 'typescript'))
  const mod = (alpha: string, beta: string) =>
    `export function alpha(): string {\n  return '${alpha}'\n}\n\nexport const beta = {\n  tag: '${beta}',\n}\n`
  writeFileSync(join(root, 'm.ts'), mod('a0', 'b0'))
  sh(root, ['add', '-A'])
  sh(root, ['commit', '-q', '-m', 'base'])
  const base = sh(root, ['rev-parse', 'HEAD'])
  return { root, base }
}
const editAlpha = (root: string) => {
  writeFileSync(join(root, 'm.ts'), `export function alpha(): string {\n  return 'a1'\n}\n\nexport const beta = {\n  tag: 'b0',\n}\n`)
  sh(root, ['commit', '-qam', 'touch alpha'])
}
const editBeta = (root: string) => {
  writeFileSync(join(root, 'm.ts'), `export function alpha(): string {\n  return 'a0'\n}\n\nexport const beta = {\n  tag: 'b1',\n}\n`)
  sh(root, ['commit', '-qam', 'touch beta'])
}
const readingAt = (sha: string, scenario = 's1') => ({ scenario, codeSha: sha, ts: '2026-07-25T00:00:00Z', scenarioHash: 'H' })
const CONTRACT = { description: 'd', expected: 'e' }
// stamped hash equal to the current declaration's, so only the CODE axis can speak
const scOf = (code: string[]) => ({ name: 's1', ...CONTRACT, code })

test('scenario code axis: an unrelated unit\'s change leaves an anchored reading FRESH; its own unit stales it', async () => {
  const { root, base } = anchorRepo()
  editBeta(root)                                  // the neighbour moved; the declared unit did not
  const idx = await driftIndex(root)
  const anchors = anchorProbeFor(root, idx)
  const sc: any = scOf(['m.ts#alpha'])
  const reading: any = { ...readingAt(base), scenarioHash: scenarioHash(sc) }
  const axis = scenarioCodeAxis(sc.code, [])
  await anchors.prime?.([{ sinceSha: base, entries: axis.entries }])
  assert.equal(changedSince(idx, base, 'm.ts'), true, 'the FILE really moved — the narrowing is what must save it')
  assert.deepEqual(staleAxes(reading, sc.code, 'n/eval.md', idx, new Map(), [], undefined, sc, anchors), [],
    'a sibling unit\'s edit must not stale a reading anchored elsewhere in the same file')
  // and the same reading, un-narrowed, is exactly the noise this replaces
  assert.deepEqual(staleAxes(reading, ['m.ts'], 'n/eval.md', idx, new Map(), [], undefined, sc), ['code'])
  rmSync(root, { recursive: true, force: true })
})

test('scenario code axis: changing the DECLARED unit still stales it', async () => {
  const { root, base } = anchorRepo()
  editAlpha(root)
  const idx = await driftIndex(root)
  const anchors = anchorProbeFor(root, idx)
  const sc: any = scOf(['m.ts#alpha'])
  const reading: any = { ...readingAt(base), scenarioHash: scenarioHash(sc) }
  await anchors.prime?.([{ sinceSha: base, entries: scenarioCodeAxis(sc.code, []).entries }])
  assert.deepEqual(staleAxes(reading, sc.code, 'n/eval.md', idx, new Map(), [], undefined, sc, anchors), ['code'])
  rmSync(root, { recursive: true, force: true })
})

test('scenario code axis: two scenarios anchoring DIFFERENT units of one file get their own verdicts', async () => {
  // the regression: keying a verdict by (sha, path) alone handed the first scenario's answer to every other
  // scenario on that file — silently, and in the FRESH direction, which is the unsafe one.
  const { root, base } = anchorRepo()
  editBeta(root)
  const idx = await driftIndex(root)
  const anchors = anchorProbeFor(root, idx)
  const onAlpha: any = scOf(['m.ts#alpha'])
  const onBeta: any = { ...scOf(['m.ts#beta']), name: 's2' }
  for (const sc of [onAlpha, onBeta]) await anchors.prime?.([{ sinceSha: base, entries: scenarioCodeAxis(sc.code, []).entries }])
  const judge = (sc: any) => staleAxes({ ...readingAt(base, sc.name), scenarioHash: scenarioHash(sc) } as any,
    sc.code, 'n/eval.md', idx, new Map(), [], undefined, sc, anchors)
  assert.deepEqual(judge(onAlpha), [], 'alpha did not move')
  assert.deepEqual(judge(onBeta), ['code'], 'beta did move — and must not inherit alpha\'s verdict')
  rmSync(root, { recursive: true, force: true })
})

test('scenario code axis: a bare entry keeps whole-file semantics, and no `code` inherits the node list', async () => {
  const { root, base } = anchorRepo()
  editBeta(root)
  const idx = await driftIndex(root)
  const anchors = anchorProbeFor(root, idx)
  const bare: any = scOf(['m.ts'])
  const reading: any = { ...readingAt(base), scenarioHash: scenarioHash(bare) }
  assert.deepEqual(staleAxes(reading, bare.code, 'n/eval.md', idx, new Map(), [], undefined, bare, anchors), ['code'],
    'an unanchored entry is unchanged by this feature')
  // a scenario declaring no code at all still inherits its node's whole list
  const inherited: any = { name: 's1', ...CONTRACT }
  assert.deepEqual(scenarioCodeAxis(inherited.code, ['m.ts']).paths, ['m.ts'])
  assert.deepEqual(staleAxes({ ...reading, scenarioHash: scenarioHash(inherited) } as any,
    ['m.ts'], 'n/eval.md', idx, new Map(), [], undefined, inherited, anchors), ['code'])
  rmSync(root, { recursive: true, force: true })
})

test('scenario code axis: a dead selector is LOUD and leaves the reading conservatively stale', async () => {
  const { root, base } = anchorRepo()
  editBeta(root)
  const idx = await driftIndex(root)
  const anchors = anchorProbeFor(root, idx)
  const sc: any = scOf(['m.ts#gone'])
  const axis = scenarioCodeAxis(sc.code, [])
  const problems = anchorProblems(root, axis.entries)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /m\.ts#gone.*names no unit/)
  await anchors.prime?.([{ sinceSha: base, entries: axis.entries }])
  assert.deepEqual(staleAxes({ ...readingAt(base), scenarioHash: scenarioHash(sc) } as any,
    sc.code, 'n/eval.md', idx, new Map(), [], undefined, sc, anchors), ['code'],
    'an unresolvable selector must cost a false stale, never a false fresh')
  rmSync(root, { recursive: true, force: true })
})

test('scenario code axis: structural misuse is reported, never silently narrowed', () => {
  assert.match(scenarioCodeAxis(['m.ts', 'm.ts#alpha'], []).problems[0], /mixes bare/)
  assert.match(scenarioCodeAxis(['src/*.ts#alpha'], []).problems[0], /selector on a glob/)
  assert.deepEqual(scenarioCodeAxis(['m.ts#alpha', 'm.ts#beta'], []).entries, [{ path: 'm.ts', selectors: ['alpha', 'beta'] }])
})

test('scenario code axis: a selector never moves the scenario contract hash', () => {
  const bare = { name: 's1', ...CONTRACT, code: ['m.ts'] }
  const anchored = { name: 's1', ...CONTRACT, code: ['m.ts#alpha', 'm.ts#beta'] }
  const none = { name: 's1', ...CONTRACT }
  assert.equal(scenarioHash(anchored), scenarioHash(bare))
  assert.equal(scenarioHash(none), scenarioHash(bare))
})

// ---- the selector-anchor verdict scope ([[selector-anchor-scope]]) ----

// Counts the git children a stretch of work actually spawns, so "issued no query" is READ off the process
// table rather than argued from timings. The probe's own scope naming is filesystem-only (headSha reads
// .git/HEAD; the interpretation is memoized), so a fully-served sweep must spawn nothing at all.
function countingGit<T>(body: () => Promise<T>): Promise<{ result: T; children: string[] }> {
  const bin = mkdtempSync(join(tmpdir(), 'freshness-anchor-bin-'))
  const log = join(bin, 'children.log')
  writeFileSync(log, '')
  writeFileSync(join(bin, 'git'), `#!/usr/bin/env node
const fs = require('node:fs'), cp = require('node:child_process')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.SPEX_ANCHOR_LOG, args.join(' ') + '\\n')
const r = cp.spawnSync(process.env.SPEX_ANCHOR_REAL_GIT, args, { input: fs.readFileSync(0), maxBuffer: 64 * 1024 * 1024 })
if (r.stdout) process.stdout.write(r.stdout)
if (r.stderr) process.stderr.write(r.stderr)
if (r.error) throw r.error
process.exit(r.status ?? 1)
`)
  chmodSync(join(bin, 'git'), 0o755)
  const previousPath = process.env.PATH
  process.env.PATH = `${bin}:${process.env.PATH ?? ''}`
  process.env.SPEX_ANCHOR_LOG = log
  process.env.SPEX_ANCHOR_REAL_GIT = REAL_GIT
  return body().then((result) => ({ result, children: readFileSync(log, 'utf8').split('\n').filter(Boolean) }))
    .finally(() => {
      process.env.PATH = previousPath
      delete process.env.SPEX_ANCHOR_LOG
      delete process.env.SPEX_ANCHOR_REAL_GIT
      rmSync(bin, { recursive: true, force: true })
    })
}

test('selector anchors: a rebuild at an unchanged head issues ZERO anchor queries', async () => {
  // The primary invariant. Milliseconds are the symptom; the query count is the thing.
  const { root, base } = anchorRepo()
  editBeta(root)
  const idx = await driftIndex(root)
  // two scenarios anchoring DIFFERENT units of one file — each is its own entry, so each is its own verdict
  const demands = [['m.ts#alpha'], ['m.ts#beta']]
    .map((code) => ({ sinceSha: base, entries: scenarioCodeAxis(code as any, []).entries }))
  const sweep = async () => {
    const probe = anchorProbeFor(root, idx)      // a whole new probe — the board builds one per read
    for (const demand of demands) await probe.prime?.([demand])
    return [probe.hit(base, 'm.ts', ['alpha']), probe.hit(base, 'm.ts', ['beta'])]
  }

  const cold = await countingGit(sweep)
  assert.ok(cold.children.length > 0, 'the first sweep must really derive the verdicts')

  const warm = await countingGit(sweep)          // same head, same demand set
  assert.deepEqual(warm.children, [], `a rebuild at an unchanged head re-derived: ${warm.children.join(' | ')}`)
  assert.deepEqual(warm.result, cold.result, 'the served verdicts must be the derived ones')
  assert.deepEqual(cold.result, [false, true], 'alpha untouched, beta moved — the answer itself')
  rmSync(root, { recursive: true, force: true })
})

test('selector anchors: a head move invalidates — an old head\'s verdict is never read back', async () => {
  // Proven with a READING, not an argument: the window `sinceSha..HEAD` lengthens as HEAD advances, so the
  // same (sinceSha, path, selectors) legitimately flips false -> true. A verdict that survived the move
  // would report the reading FRESH after its own unit moved — the unsafe direction.
  const { root, base } = anchorRepo()
  const sc: any = scOf(['m.ts#alpha'])
  const reading: any = { ...readingAt(base), scenarioHash: scenarioHash(sc) }
  const entries = scenarioCodeAxis(sc.code, []).entries

  const before = await driftIndex(root)
  const first = anchorProbeFor(root, before)
  await first.prime?.([{ sinceSha: base, entries }])
  assert.equal(first.hit(base, 'm.ts', ['alpha']), false, 'nothing has touched alpha yet')
  assert.deepEqual(staleAxes(reading, sc.code, 'n/eval.md', before, new Map(), [], undefined, sc, first), [])

  editAlpha(root)                                   // the head moves, and it moves THROUGH the anchored unit
  const after = await driftIndex(root)
  const second = anchorProbeFor(root, after)
  await second.prime?.([{ sinceSha: base, entries }])
  assert.equal(second.hit(base, 'm.ts', ['alpha']), true,
    'the pre-move verdict survived the head move and reported a moved unit as untouched')
  assert.deepEqual(staleAxes(reading, sc.code, 'n/eval.md', after, new Map(), [], undefined, sc, second), ['code'])
  rmSync(root, { recursive: true, force: true })
})

test('selector anchors: editing the source a selector resolves against invalidates its verdict', async () => {
  // The one input the head does NOT fix. The working tree is dirty by construction while a session works, and
  // the units a selector resolves to come from those exact bytes — so the image is part of the key.
  const { root, base } = anchorRepo()
  editBeta(root)
  const idx = await driftIndex(root)
  const entries = scenarioCodeAxis(['m.ts#alpha'] as any, []).entries
  const first = anchorProbeFor(root, idx)
  await first.prime?.([{ sinceSha: base, entries }])
  assert.equal(first.hit(base, 'm.ts', ['alpha']), false)

  // rename the unit in the WORKING TREE only — no commit, so the head has not moved at all
  writeFileSync(join(root, 'm.ts'), 'export function renamed(): string {\n  return \'a0\'\n}\n\nexport const beta = {\n  tag: \'b1\',\n}\n')
  const second = anchorProbeFor(root, idx)
  await second.prime?.([{ sinceSha: base, entries }])
  assert.equal(second.hit(base, 'm.ts', ['alpha']), null,
    'a now-DEAD selector inherited the verdict it had while it still resolved — a dead anchor reading fresh')
  rmSync(root, { recursive: true, force: true })
})

test('selector anchors: three rebuilds over the same demands hold one generation, not three', async () => {
  const { root, base } = anchorRepo()
  editBeta(root)
  const demands = [['m.ts#alpha'], ['m.ts#beta']]
    .map((code) => ({ sinceSha: base, entries: scenarioCodeAxis(code as any, []).entries }))
  const sizes: number[] = []
  const idx = await driftIndex(root)
  for (let round = 0; round < 3; round++) {
    const probe = anchorProbeFor(root, idx)
    for (const demand of demands) await probe.prime?.([demand])
    sizes.push(anchorVerdictCacheSize(root))
  }
  assert.deepEqual(sizes, [sizes[0], sizes[0], sizes[0]],
    `cardinality grew with rebuild count instead of staying at the corpus: ${sizes.join(' -> ')}`)
  assert.equal(sizes[0], 2, 'one verdict per (reading, anchored entry) at the current head')
  rmSync(root, { recursive: true, force: true })
})
