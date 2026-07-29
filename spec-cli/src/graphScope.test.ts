import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

// @@@ boardScope — pins the SPLICE-EQUIVALENCE contract of the scoped board cache ([[graph-cache]]):
//   1. spliceSessions(prev) is byte-indistinguishable from a fresh buildBoard() when only SESSION state moved
//      (a lifecycle write) — the sessions slice is re-derived, the node/meta units are reused verbatim.
//   2. graphCache's scope has a DOMAIN, not just a dirty bit: a true session-only invalidation splices, while a
//      nominal session refresh promotes itself when the cache-owned full revision reveals a missed graph change;
//      a 'sessions' signal followed by a 'full' one also ESCALATES to a full rebuild.
//
// RIG NOTE (why the fixture is built BEFORE the dynamic imports): specs.ts freezes `ROOT = repoRoot()` at
// MODULE-IMPORT time from process.cwd(), git.ts memoizes repoRoot() on first call, and sessions.ts reads
// TMUX_SOCK = process.env.SPEXCODE_TMUX at import. So we must chdir into a temp fixture repo and set the
// isolating env FIRST, then `await import()` graph/graphCache so every git/spec/tmux resolution lands on the
// fixture — never the real repo or the real ~/.spexcode. Node runs each test FILE in its own process, so the
// module-level caches (repoRoot, gitCommonDir, graphCache's cached/dirty/inflight) are ours alone.

function gitAvailable(): boolean {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true } catch { return false }
}
const gitOk = gitAvailable()

const proj = mkdtempSync(join(tmpdir(), 'boardscope-proj-'))
const home = mkdtempSync(join(tmpdir(), 'boardscope-home-'))
const SESS_ID = 'boardscope-sess-0001'

const g = (...a: string[]) => execFileSync('git', ['-C', proj, ...a], { encoding: 'utf8' })

// write a spec node's spec.md (working tree) — used at setup AND mid-test to mutate a NODE.
function writeSpec(relDir: string, title: string, status = 'active', body = 'Body prose stating the node intent.') {
  mkdirSync(join(proj, relDir), { recursive: true })
  writeFileSync(join(proj, relDir, 'spec.md'),
    `---\ntitle: ${title}\nstatus: ${status}\nhue: 210\ndesc: fixture node\n---\n\n${body}\n`)
}

// the fields (and one-field-per-line JSON shape) are copied from sessions.ts writeRecord — every key always
// present, nulls rendered as "". A partial override merges onto this base so a test can move ONLY session state.
function baseRecord() {
  return {
    session_id: SESS_ID,
    governed: true,
    worktree_path: proj,
    branch: 'node/child-bs01',
    node: 'child',
    title: 'test session',
    name: '',
    parent: '',
    status: 'active',
    proposal: '',
    merges: 0,
    note: 'first',
    sortkey: '',
    createdAt: 1700000000000,
    harness: 'claude',
    harness_session_id: '',
    launcher: 'reclaude',
    launch_cmd: 'reclaude --dangerously-skip-permissions',
  }
}

// dynamic-import handles, resolved below only when git is available (see RIG NOTE).
let board: typeof import('./graph.js')
let cache: typeof import('./graphCache.js')
let layout: typeof import('./layout.js')
let evalProjection: typeof import('../../spec-eval/src/sessioneval.js')

function writeSessionRecord(over: Record<string, unknown>) {
  const rec = { ...baseRecord(), ...over }
  mkdirSync(layout.sessionStoreDir(SESS_ID), { recursive: true })
  writeFileSync(layout.sessionRecordPath(SESS_ID), JSON.stringify(rec, null, 2) + '\n')
}

async function waitForFile(path: string, message: string): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!existsSync(path)) {
    if (Date.now() >= deadline) assert.fail(message)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function gatedTmux(root: string): { bin: string; hold: string; claimed: string } {
  const bin = join(root, 'tmux-bin')
  const hold = join(root, 'hold-tmux')
  const claimed = join(root, 'tmux-claimed')
  mkdirSync(bin, { recursive: true })
  const tmux = join(bin, 'tmux')
  writeFileSync(tmux, `#!/bin/sh
if [ -e "${hold}" ] && [ ! -e "${claimed}" ]; then
  : > "${claimed}"
  while [ -e "${hold}" ]; do sleep 0.01; done
fi
exit 1
`)
  chmodSync(tmux, 0o755)
  return { bin, hold, claimed }
}

function logGitCalls(root: string, bin: string): string {
  const log = join(root, 'git-calls')
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
  assert.ok(realGit, 'fixture could not resolve the real git binary')
  writeFileSync(join(bin, 'git'), `#!/bin/sh
printf '%s\\n' "$*" >> "${log}"
exec "${realGit}" "$@"
`)
  chmodSync(join(bin, 'git'), 0o755)
  return log
}

function gatedGit(root: string): { bin: string; hold: string; claimed: string } {
  const bin = join(root, 'git-bin')
  const hold = join(root, 'hold-git')
  const claimed = join(root, 'git-claimed')
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
  assert.ok(realGit, 'fixture could not resolve the real git binary')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'git'), `#!/bin/sh
if [ -e "${hold}" ] && [ ! -e "${claimed}" ]; then
  : > "${claimed}"
  while [ -e "${hold}" ]; do sleep 0.01; done
fi
exec "${realGit}" "$@"
`)
  chmodSync(join(bin, 'git'), 0o755)
  return { bin, hold, claimed }
}

if (gitOk) {
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
  writeFileSync(join(proj, 'README.md'), '# fixture\n')
  writeSpec('.spec/proj', 'Fixture Project')            // root node
  writeSpec('.spec/proj/child', 'Child Node ORIGINAL')  // one child node — the mutation target for scope test
  g('add', '-A'); g('commit', '-qm', 'init fixture')

  // isolate BEFORE the imports: SPEXCODE_HOME (read live) points the session store at a temp dir; SPEXCODE_TMUX
  // (read at sessions.ts import) is an EMPTY socket with no server, so liveness reads a deterministic `offline`
  // in every build (no real tmux session of the box can interfere). chdir so repoRoot()/ROOT resolve to `proj`.
  process.env.SPEXCODE_HOME = home
  process.env.SPEXCODE_TMUX = 'boardscope-iso'
  process.env.SPEXCODE_BOARD_DEBUG = '1'
  delete process.env.SPEXCODE_SESSION_ID
  process.chdir(proj)

  board = await import('./graph.js')
  cache = await import('./graphCache.js')
  layout = await import('./layout.js')
  evalProjection = await import('../../spec-eval/src/sessioneval.js')

  writeSessionRecord({ status: 'active', note: 'first' })   // one governed record in the isolated store
}

// Production graph-cache always lives behind a referenced server socket. Keep the fixture at that same
// lifecycle altitude so its deliberately-unref'ed background-start timer can run before test teardown.
const backendLifetime = setInterval(() => {}, 60_000)
test.after(() => clearInterval(backendLifetime))

// ---------------------------------------------------------------------------------------------------------
// 1. EQUIVALENCE — spliceSessions(prev) == a fresh buildBoard() when only SESSION state changed.
// ---------------------------------------------------------------------------------------------------------
test('spliceSessions is byte-identical to a fresh buildBoard when only session state moved', { skip: !gitOk && 'git not available' }, async () => {
  // The lean eval projection is an independent async unit. Fix its generation before comparing the two
  // board assembly paths; otherwise the first assembly may honestly read `loading` while the second reads
  // the completed `error`/`ready` state, which is a time change rather than a splice-equivalence failure.
  await board.buildBoard()
  await evalProjection.awaitSessionEvalProjectionIdle()
  const A = await board.buildBoard()
  assert.equal(A.sessions.length, 1, 'the one governed record is enumerated')
  assert.equal(A.sessions[0].id, SESS_ID)
  assert.equal(A.sessions[0].status, 'offline', 'no tmux on the isolated socket → deterministic offline')
  assert.equal(A.sessions[0].ops.length, 0, 'no pending spec ops (worktree on main)')

  // mutate ONLY session state on disk: active → awaiting/proposal=nothing (a lifecycle write) + a new note.
  writeSessionRecord({ status: 'awaiting', proposal: 'nothing', note: 'second' })

  const Bfull = await board.buildBoard()        // fresh full assembly reads the new record
  const Bsplice = await board.spliceSessions(A) // sessions-only re-derive spliced onto A

  // the mutation actually MOVED the row — guards against a no-op false pass (offline → done, note → second).
  assert.equal(Bfull.sessions[0].status, 'done', 'awaiting+proposal:nothing reconciles to "done"')
  assert.equal(Bfull.sessions[0].note, 'second')
  assert.notEqual(JSON.stringify(A.sessions), JSON.stringify(Bfull.sessions), 'session slice genuinely changed')

  // EQUIVALENCE: the sessions slice from the splice is byte-indistinguishable from the full rebuild's.
  assert.equal(JSON.stringify(Bsplice.sessions), JSON.stringify(Bfull.sessions),
    'spliceSessions reproduces buildBoard sessions exactly')

  // node/meta units are UNTOUCHED by the splice — the SAME objects as the previous board (splice is {...prev}).
  assert.equal(Bsplice.nodes, A.nodes, 'nodes: identical object reference (reused, not rebuilt)')
  assert.equal(Bsplice.identity, A.identity)
  // and nodes are session-independent: a fresh full build serializes its nodes identically to A's.
  assert.equal(JSON.stringify(Bfull.nodes), JSON.stringify(A.nodes), 'a session-only change leaves nodes byte-identical')
})

// ---------------------------------------------------------------------------------------------------------
// 2. SCOPE ESCALATION (graphCache) — one sequential test so getBoard's module state stays order-deterministic.
//    A true session-only invalidation SPLICES. A missed graph input promotes that nominal session refresh, while
//    an explicit 'sessions' signal followed by 'full' also escalates before one producer starts.
// ---------------------------------------------------------------------------------------------------------
test('boardCache scope: sessions-scoped splices (skips node work), full-scoped (incl. escalated) rebuilds', { skip: !gitOk && 'git not available' }, async () => {
  cache.invalidateBoard('full')                 // clean full baseline regardless of prior module state
  const b0 = await cache.getBoard()
  assert.equal(b0.nodes.find((n: any) => n.id === 'child')?.title, 'Child Node ORIGINAL')

  // A true session-only move takes the splice path and keeps the node/meta anchor byte-for-byte.
  writeSessionRecord({ status: 'active', note: 'session splice' })
  cache.invalidateBoard('sessions')
  const b1 = await cache.getBoard()
  assert.equal(b1.nodes, b0.nodes, 'splice reuses the cached node objects (same reference)')
  assert.equal(b1.sessions[0].note, 'session splice')

  // A session watcher can fire alongside a graph-domain event another watcher missed. The cache must compare
  // the node/meta revision it owns before splicing; otherwise it could bind old nodes to the new full revision
  // and every later patrol would falsely certify the stale graph forever.
  writeSpec('.spec/proj/child', 'Child Node CHANGED')
  writeSessionRecord({ status: 'active', note: 'session event beside missed full change' })
  cache.invalidateBoard('sessions')
  const b2 = await cache.getBoard()
  assert.equal(b2.nodes.find((n: any) => n.id === 'child')?.title, 'Child Node CHANGED',
    'a moved full revision promotes a nominal session refresh to the full producer')
  assert.notEqual(b2.nodes, b1.nodes, 'the stale node/meta anchor must not survive the promoted refresh')

  // Explicit escalation still owns one full producer (full subsumes the pending session scope).
  cache.invalidateBoard('sessions')
  cache.invalidateBoard('full')
  const b3 = await cache.getBoard()
  assert.notEqual(b3.nodes, b2.nodes, 'an explicitly escalated full rebuild produced fresh node objects')

  // Patrol repairs derive their scope from the changed revision component. A missed record event is
  // sessions-only: the row advances, while the full node graph stays the exact object returned above.
  writeSessionRecord({ status: 'active', note: 'patrol session repair' })
  const b4 = await cache.patrolBoard()
  assert.equal(b4.nodes, b3.nodes, 'a session-only patrol repair must splice, not promote to full')
  assert.equal(b4.sessions[0].note, 'patrol session repair')

  // The prompt is a separate store artifact but a first-class board row field. A missed prompt write must move
  // the sessions revision just like session.json, without paying for a node rebuild.
  writeFileSync(layout.sessionArtifactPath(SESS_ID, 'prompt'), 'A newly discovered originating prompt.\n')
  const b5 = await cache.patrolBoard()
  assert.equal(b5.nodes, b4.nodes, 'a prompt-only repair remains sessions-scoped')
  assert.equal(b5.sessions[0].prompt, 'A newly discovered originating prompt.\n')
})

test('a held old-topology splice rebases after full completion and cannot erase nodes or ops', { skip: !gitOk && 'git not available' }, async () => {
  const linked = join(tmpdir(), `boardscope-linked-${process.pid}-${Date.now()}`)
  const gateRoot = mkdtempSync(join(tmpdir(), 'boardscope-tmux-gate-'))
  const gate = gatedTmux(gateRoot)
  const previousPath = process.env.PATH
  process.env.PATH = `${gate.bin}:${previousPath}`
  try {
    g('worktree', 'add', '-q', '-b', 'node/rebase-gate', linked)
    writeSessionRecord({ worktree_path: linked, branch: 'node/rebase-gate', name: '' })
    cache.invalidateBoard('full')
    await cache.getBoard()

    writeFileSync(gate.hold, 'hold\n')
    writeSessionRecord({ worktree_path: linked, branch: 'node/rebase-gate', name: 'Newest session row' })
    cache.invalidateBoard('sessions')
    const oldBaseSplice = cache.getBoardForSessionRefresh()
    await waitForFile(gate.claimed, 'the session splice never reached its controlled tmux gate')

    writeSpec('.spec/proj/new-topology', 'New Topology Node')
    writeFileSync(join(linked, '.spec', 'proj', 'child', 'spec.md'),
      '---\ntitle: Child Node DIRTY\nstatus: active\nhue: 210\ndesc: fixture node\n---\n\nDirty worktree body.\n')
    cache.invalidateBoard('full')
    const full = await cache.getBoard()
    assert.equal(full.nodes.find((node: any) => node.id === 'new-topology')?.title, 'New Topology Node')
    assert.ok(full.sessions[0].ops.length > 0, 'the new full topology carries the linked worktree ops')

    rmSync(gate.hold, { force: true })
    const rebased = await oldBaseSplice
    const final = await cache.getBoard()
    assert.equal(rebased.nodes, full.nodes, 'the delayed splice must rebase on the full nodes, not its old base')
    assert.equal(final.nodes, full.nodes, 'the final cache keeps the completed full topology')
    assert.ok(final.sessions[0].ops.length > 0, 'the delayed splice keeps the completed full ops')
    assert.equal(final.sessions[0].raw?.name, 'Newest session row')
  } finally {
    rmSync(gate.hold, { force: true })
    process.env.PATH = previousPath
    try { g('worktree', 'remove', '--force', linked) } catch { rmSync(linked, { recursive: true, force: true }) }
    rmSync(gateRoot, { recursive: true, force: true })
  }
})

test('a splice retains its base full revision so patrol still repairs an unseen topology change', { skip: !gitOk && 'git not available' }, async () => {
  const gateRoot = mkdtempSync(join(tmpdir(), 'boardscope-patrol-gate-'))
  const gate = gatedTmux(gateRoot)
  const previousPath = process.env.PATH
  process.env.PATH = `${gate.bin}:${previousPath}`
  try {
    cache.invalidateBoard('full')
    await cache.getBoard()
    writeFileSync(gate.hold, 'hold\n')
    writeSessionRecord({ name: 'Patrol splice row', worktree_path: proj, branch: 'node/child-bs01' })
    cache.invalidateBoard('sessions')
    const splice = cache.getBoardForSessionRefresh()
    await waitForFile(gate.claimed, 'the splice never reached its controlled tmux gate')
    writeSpec('.spec/proj/patrol-topology', 'Patrol Must Rebuild')
    rmSync(gate.hold, { force: true })
    const staleTopology = await splice
    assert.equal(staleTopology.nodes.some((node: any) => node.id === 'patrol-topology'), false,
      'the held splice intentionally still carries its old topology')
    const repaired = await cache.patrolBoard()
    assert.equal(repaired.nodes.find((node: any) => node.id === 'patrol-topology')?.title, 'Patrol Must Rebuild',
      'the splice must not certify current full inputs for old nodes')
  } finally {
    rmSync(gate.hold, { force: true })
    process.env.PATH = previousPath
    rmSync(gateRoot, { recursive: true, force: true })
  }
})

test('a second session invalidation during one splice converges to its newest generation', { skip: !gitOk && 'git not available' }, async () => {
  const gateRoot = mkdtempSync(join(tmpdir(), 'boardscope-generation-gate-'))
  const gate = gatedTmux(gateRoot)
  const previousPath = process.env.PATH
  process.env.PATH = `${gate.bin}:${previousPath}`
  try {
    cache.invalidateBoard('full')
    await cache.getBoard()
    writeFileSync(gate.hold, 'hold\n')
    writeSessionRecord({ name: 'Generation one', worktree_path: proj, branch: 'node/child-bs01' })
    cache.invalidateBoard('sessions')
    const first = cache.getBoardForSessionRefresh()
    await waitForFile(gate.claimed, 'the first session projection never reached its gate')
    writeSessionRecord({ name: 'Generation two', worktree_path: proj, branch: 'node/child-bs01' })
    cache.invalidateBoard('sessions')
    const second = cache.getBoardForSessionRefresh()
    rmSync(gate.hold, { force: true })
    await Promise.all([first, second])
    const final = await cache.getBoard()
    assert.equal(final.sessions[0].raw?.name, 'Generation two')
  } finally {
    rmSync(gate.hold, { force: true })
    process.env.PATH = previousPath
    rmSync(gateRoot, { recursive: true, force: true })
  }
})

test('a held session splice keeps stale reads refreshing without starting a full revision walk', { skip: !gitOk && 'git not available' }, async () => {
  const gateRoot = mkdtempSync(join(tmpdir(), 'boardscope-stale-session-gate-'))
  const gate = gatedTmux(gateRoot)
  const gitLog = logGitCalls(gateRoot, gate.bin)
  const previousPath = process.env.PATH
  try {
    cache.invalidateBoard('full')
    const baseline = await cache.getBoard()
    const lastGoodName = baseline.sessions[0].raw?.name
    process.env.PATH = `${gate.bin}:${previousPath}`
    writeFileSync(gate.hold, 'hold\n')
    writeSessionRecord({ name: 'Held projection row', worktree_path: proj, branch: 'node/child-bs01' })
    cache.invalidateBoard('sessions')
    const projection = cache.getBoardForSessionRefresh()
    await waitForFile(gate.claimed, 'the session splice never reached its controlled tmux gate')

    const stale = await cache.readBoard('stale-ok')
    assert.equal(stale.freshness, 'stale', 'the route surface remains stale while the projection owns refresh')
    assert.equal(stale.refreshing, true, 'the route surface reports the held projection as refreshing')
    assert.equal(stale.board.sessions[0].raw?.name, lastGoodName, 'stale reads return last-good rows')
    assert.equal(existsSync(gitLog), false, 'a session splice must not start the full input-revision walk')

    rmSync(gate.hold, { force: true })
    const projected = await projection
    assert.equal(projected.sessions[0].raw?.name, 'Held projection row')
    const fresh = await cache.getBoard()
    assert.equal(fresh.sessions[0].raw?.name, 'Held projection row')
    assert.equal(existsSync(gitLog), false, 'stale-ok must not queue a full producer beside the held splice')
  } finally {
    rmSync(gate.hold, { force: true })
    process.env.PATH = previousPath
    rmSync(gateRoot, { recursive: true, force: true })
  }
})

test('a full completion re-bases a published session projection and leaves only one later generation owed', { skip: !gitOk && 'git not available' }, async () => {
  const linked = join(tmpdir(), `boardscope-full-publication-${process.pid}-${Date.now()}`)
  const gateRoot = mkdtempSync(join(tmpdir(), 'boardscope-full-publication-gate-'))
  const gate = gatedGit(gateRoot)
  const previousPath = process.env.PATH
  try {
    g('worktree', 'add', '-q', '-b', 'node/full-publication', linked)
    writeSessionRecord({ worktree_path: linked, branch: 'node/full-publication', name: 'Before full publication' })
    cache.invalidateBoard('full')
    await cache.getBoard()

    writeFileSync(gate.hold, 'hold\n')
    process.env.PATH = `${gate.bin}:${previousPath}`
    writeSpec('.spec/proj/full-publication-node', 'Full Publication Node')
    writeFileSync(join(linked, '.spec', 'proj', 'child', 'spec.md'),
      '---\ntitle: Child Node FULL OPS\nstatus: active\nhue: 210\ndesc: fixture node\n---\n\nDirty full topology body.\n')
    cache.invalidateBoard('full')
    const full = cache.getBoard()
    await waitForFile(gate.claimed, 'the full producer never reached its controlled git gate')

    writeSessionRecord({ worktree_path: linked, branch: 'node/full-publication', name: 'Published while full held' })
    cache.invalidateBoard('sessions')
    const published = await cache.getBoardForSessionRefresh()
    assert.equal(published.sessions[0].raw?.name, 'Published while full held')

    // This is deliberately not projected before releasing full. It proves full completion does not wait for a
    // globally quiet store: it preserves the row clients already saw, commits topology once, and leaves one
    // bounded cheap follow-up for the newer un-published generation.
    writeSessionRecord({ worktree_path: linked, branch: 'node/full-publication', name: 'Owed after publication' })
    cache.invalidateBoard('sessions')
    rmSync(gate.hold, { force: true })

    const completed = await full
    assert.equal(completed.nodes.find((node: any) => node.id === 'full-publication-node')?.title, 'Full Publication Node')
    assert.ok(completed.sessions[0].ops.length > 0, 'the completed full retains its newer worktree ops')
    assert.equal(completed.sessions[0].raw?.name, 'Published while full held',
      'the full result must rebase the already-published session row instead of rolling it back')

    const converged = await cache.getBoardForSessionRefresh()
    assert.equal(converged.nodes.find((node: any) => node.id === 'full-publication-node')?.title, 'Full Publication Node')
    assert.ok(converged.sessions[0].ops.length > 0, 'the bounded follow-up keeps the completed full ops')
    assert.equal(converged.sessions[0].raw?.name, 'Owed after publication')
  } finally {
    rmSync(gate.hold, { force: true })
    process.env.PATH = previousPath
    try { g('worktree', 'remove', '--force', linked) } catch { rmSync(linked, { recursive: true, force: true }) }
    rmSync(gateRoot, { recursive: true, force: true })
  }
})
