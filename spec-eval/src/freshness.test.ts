import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { changedSince, codeDrift, contentProbeFor, staleAxes, remarkStale, type ContentProbe, type RemarkSignal } from './freshness.js'
import { scenarioHash } from './scenarios.js'
import { withGitAbortSignal, type DriftIndex } from '../../spec-cli/src/git.js'

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
  return { ord, parents: p, fileCommits: new Map(fileCommits), acks: new Map(), specNodes: new Map(), anc: new Map() }
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

// a hand-built probe: `diff` = the changed-paths set (null = anchor commit object gone), `blocks` answers
// scenarioDiffers. Also asserts the in-history fast path NEVER consults the probe.
function probeOf(diff: Set<string> | null, scenarioDiffers = false): ContentProbe {
  return {
    changedPaths: () => diff,
    scenarioDiffers: () => scenarioDiffers,
    behind: () => 7,
  }
}
const throwingProbe: ContentProbe = {
  changedPaths: () => { throw new Error('probe consulted on the in-history fast path') },
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

// ---- the off-history heavy-diff scheduler: actual child starts, queueing, and abort recovery ----

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
    sh(root, ['add', 'tracked.txt'])
    sh(root, ['commit', '-q', '-m', `c${i}`])
    hashes.push(sh(root, ['rev-parse', 'HEAD']))
  }
  return { root, hashes }
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
  *" diff --name-only --no-renames "*)
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

test('content scheduler: 9 concurrent probes for one diffKey spawn exactly one heavy diff', async () => {
  const { root, hashes } = schedulerRepo(2)
  const trace = diffTrace()
  try {
    const probes = Array.from({ length: 9 }, () => contentProbeFor(root))
    await Promise.all(probes.map((probe) => probe.prime!(hashes[0], [], 'absent-eval.md')))
    assert.equal(trace.events().filter((event) => event.event === 'start').length, 1)
    assert.ok(probes.every((probe) => probe.changedPaths(hashes[0])?.has('tracked.txt')))
    await probes[0].prime!(hashes[0], [], 'absent-eval.md')
    assert.equal(trace.events().filter((event) => event.event === 'start').length, 1, 'settled LRU serves the repeat')
  } finally {
    trace.restore()
  }
})

test('content scheduler: 14 unique anchors under one root+HEAD run with maxHeavy=1', async () => {
  const { root, hashes } = schedulerRepo(15)
  const trace = diffTrace()
  try {
    await Promise.all(hashes.slice(0, 14).map((sha) => contentProbeFor(root).prime!(sha, [], 'absent-eval.md')))
    const events = trace.events()
    assert.equal(events.filter((event) => event.event === 'start').length, 14)
    assert.deepEqual(peakActive(events), { peak: 1, final: 0 })
  } finally {
    trace.restore()
  }
})

test('content scheduler: abort removes active and queued flights, then both retry without a ghost spawn', async () => {
  const { root, hashes } = schedulerRepo(3)
  const trace = diffTrace('0')
  writeFileSync(trace.hang, '')
  try {
    const controller = new AbortController()
    const results = await withGitAbortSignal(controller.signal, async () => {
      const active = contentProbeFor(root).prime!(hashes[0], [], 'absent-eval.md')
      await waitFor(() => trace.events().some((event) => event.event === 'start'))
      const queued = contentProbeFor(root).prime!(hashes[1], [], 'absent-eval.md')
      controller.abort()
      return Promise.allSettled([active, queued])
    })
    assert.ok(results.every((result) => result.status === 'rejected' && result.reason?.name === 'AbortError'))
    assert.equal(trace.events().filter((event) => event.event === 'start').length, 1, 'queued abort never spawns')

    rmSync(trace.hang)
    await Promise.all([
      contentProbeFor(root).prime!(hashes[0], [], 'absent-eval.md'),
      contentProbeFor(root).prime!(hashes[1], [], 'absent-eval.md'),
    ])
    assert.equal(trace.events().filter((event) => event.event === 'start').length, 3,
      'active and queued failures both leave retryable flights and no ghost waiter')
  } finally {
    trace.restore()
  }
})

test('content scheduler: equal SHA keys in two roots neither coalesce nor serialize each other', async () => {
  const first = schedulerRepo(2)
  const secondRoot = mkdtempSync(join(tmpdir(), 'freshness-scheduler-clone-'))
  execFileSync(REAL_GIT, ['clone', '-q', first.root, secondRoot])
  const trace = diffTrace('0.1')
  try {
    await Promise.all([
      contentProbeFor(first.root).prime!(first.hashes[0], [], 'absent-eval.md'),
      contentProbeFor(secondRoot).prime!(first.hashes[0], [], 'absent-eval.md'),
    ])
    const events = trace.events()
    assert.equal(events.filter((event) => event.event === 'start').length, 2)
    assert.equal(events.filter((event) => event.event === 'start' && event.argv.includes(`-C ${first.root} `)).length, 1)
    assert.equal(events.filter((event) => event.event === 'start' && event.argv.includes(`-C ${secondRoot} `)).length, 1)
    assert.equal(peakActive(events).peak, 2, 'independent roots own independent heavy-diff scopes')
  } finally {
    trace.restore()
  }
})

test('content scheduler: moving HEAD creates a new scope and query while the old result stays bounded in LRU', async () => {
  const { root, hashes } = schedulerRepo(2)
  const trace = diffTrace()
  try {
    const before = contentProbeFor(root)
    await before.prime!(hashes[0], [], 'absent-eval.md')
    writeFileSync(join(root, 'after-head-move.txt'), 'new\n')
    sh(root, ['add', 'after-head-move.txt'])
    sh(root, ['commit', '-q', '-m', 'move head'])
    const after = contentProbeFor(root)
    await after.prime!(hashes[0], [], 'absent-eval.md')
    assert.equal(trace.events().filter((event) => event.event === 'start').length, 2)
    assert.equal(before.changedPaths(hashes[0])?.has('after-head-move.txt'), false)
    assert.equal(after.changedPaths(hashes[0])?.has('after-head-move.txt'), true)
  } finally {
    trace.restore()
  }
})

test('content scheduler: spawn failure is loud, not memoized, and a repaired child path retries', async () => {
  const { root, hashes } = schedulerRepo(2)
  const trace = diffTrace()
  try {
    process.env.PATH = trace.bin
    chmodSync(trace.shim, 0o644)
    await assert.rejects(contentProbeFor(root).prime!(hashes[0], [], 'absent-eval.md'), /git content diff failed \(spawn\)/)
    chmodSync(trace.shim, 0o755)
    const retry = contentProbeFor(root)
    await retry.prime!(hashes[0], [], 'absent-eval.md')
    assert.equal(trace.events().filter((event) => event.event === 'start').length, 1)
    assert.ok(retry.changedPaths(hashes[0])?.has('tracked.txt'))
  } finally {
    trace.restore()
  }
})
