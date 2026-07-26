import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { changedSince, codeDrift, contentProbeFor, anchorProbeFor, anchorProblems, freshnessCacheSize, staleAxes, remarkStale, type ContentProbe, type RemarkSignal } from './freshness.js'
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
  return { ord, parents: p, fileEvents, acks: new Map(), specNodes: new Map(), anc: new Map() }
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
// `blocks` answers scenarioDiffers. Also asserts the in-history fast path NEVER consults the probe.
function probeOf(diff: Set<string> | null, scenarioDiffers = false): ContentProbe {
  return {
    changed: (_sha, path) => (diff ? diff.has(path) : null),
    canTestify: () => diff !== null,
    scenarioDiffers: () => scenarioDiffers,
    behind: () => 7,
  }
}
const throwingProbe: ContentProbe = {
  changed: () => { throw new Error('probe consulted on the in-history fast path') },
  canTestify: () => { throw new Error('probe consulted on the in-history fast path') },
  scenarioDiffers: () => { throw new Error('probe consulted on the in-history fast path') },
  behind: () => { throw new Error('probe consulted on the in-history fast path') },
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

test('codeDrift: off-history fallback reports only content-changed files, by the probe count', () => {
  const i = didx({ TIP: ['BASE'], BASE: [] }, [['a.ts', ['BASE']], ['b.ts', ['BASE']]])
  const probe = probeOf(new Set(['a.ts']))
  assert.deepEqual(codeDrift(i, 'GONE', ['a.ts', 'b.ts'], probe), [{ file: 'a.ts', behind: 7 }])
  // no probe → the old conservative every-touch count
  assert.deepEqual(codeDrift(i, 'GONE', ['a.ts', 'b.ts']), [{ file: 'a.ts', behind: 1 }, { file: 'b.ts', behind: 1 }])
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
type TraceEvent = { event: 'start' | 'end'; pid: string; argv: string }
function diffTrace(delay = '0.03') {
  const bin = mkdtempSync(join(tmpdir(), 'freshness-git-bin-'))
  const log = join(bin, 'events.log')
  const hang = join(bin, 'hang')
  const shim = join(bin, 'git')
  writeFileSync(log, '')
  writeFileSync(shim, `#!/bin/sh
case " $* " in
  *" diff --name-only -z --no-renames "*)
    printf 'start\\t%s\\t%s\\n' "$$" "$*" >> "$SPEX_TEST_DIFF_LOG"
    if [ -n "$SPEX_TEST_DIFF_HANG" ] && [ -e "$SPEX_TEST_DIFF_HANG" ]; then sleep 60; fi
    if [ -n "$SPEX_TEST_DIFF_DELAY" ]; then sleep "$SPEX_TEST_DIFF_DELAY"; fi
    "$SPEX_TEST_REAL_GIT" "$@"
    code=$?
    printf 'end\\t%s\\t%s\\n' "$$" "$*" >> "$SPEX_TEST_DIFF_LOG"
    exit $code
    ;;
  *) exec "$SPEX_TEST_REAL_GIT" "$@" ;;
esac
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
  const events = (): TraceEvent[] => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => {
    const [event, pid, ...argv] = line.split('\t')
    return { event: event as TraceEvent['event'], pid, argv: argv.join('\t') }
  })
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

test('content batch: 14 unique anchors under one root+HEAD run one child at a time', async () => {
  const { root, hashes } = schedulerRepo(15)
  const trace = diffTrace()
  try {
    await Promise.all(hashes.slice(0, 14).map((sha) => contentProbeFor(root).prime!(sha, ['tracked.txt'], 'absent-eval.md')))
    const events = trace.events()
    assert.equal(events.filter((event) => event.event === 'start').length, 14)
    assert.deepEqual(peakActive(events), { peak: 1, final: 0 })
  } finally {
    trace.restore()
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
    await assert.rejects(contentProbeFor(root).prime!(hashes[0], ['tracked.txt'], 'absent-eval.md'), /git content diff failed \(spawn\)/)
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
  await anchors.prime?.(base, axis.entries)
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
  await anchors.prime?.(base, scenarioCodeAxis(sc.code, []).entries)
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
  for (const sc of [onAlpha, onBeta]) await anchors.prime?.(base, scenarioCodeAxis(sc.code, []).entries)
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
  await anchors.prime?.(base, axis.entries)
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
