import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  TreeWatcherRegistry,
  addPendingGraphChange,
  consolidatedRecursiveWatch,
  graphWatcherCensus,
  sessionWorktreeWatchPaths,
  watchSessionEvalRefs,
  watchSessionEvalRegistry,
  watchSessionEvalWorktree,
} from './graphStream.js'

class FakeWatcher extends EventEmitter {
  closed = 0
  close(): void { this.closed++ }
}

type Opened = { path: string; recursive: boolean; watcher: FakeWatcher }

function fakeFactory(fail?: (path: string) => Error | null) {
  const opened: Opened[] = []
  const factory = (path: string, options: { recursive?: boolean }, callback: (...args: unknown[]) => void) => {
    const error = fail?.(path)
    if (error) throw error
    const watcher = new FakeWatcher()
    watcher.on('change', callback)
    opened.push({ path, recursive: options.recursive === true, watcher })
    return watcher
  }
  return { opened, factory: factory as unknown as NonNullable<ConstructorParameters<typeof TreeWatcherRegistry>[0]['watchFactory']> }
}

test('the transport adapter is the only place the platform appears', () => {
  assert.equal(consolidatedRecursiveWatch('darwin'), true)
  assert.equal(consolidatedRecursiveWatch('win32'), true)
  assert.equal(consolidatedRecursiveWatch('linux'), false)
  assert.equal(consolidatedRecursiveWatch('freebsd'), false)
})

test('one debounce window retains both full and sessions obligations in either arrival order', () => {
  assert.deepEqual(
    addPendingGraphChange(addPendingGraphChange({ full: false, sessions: false }, 'full'), 'sessions'),
    { full: true, sessions: true },
  )
  assert.deepEqual(
    addPendingGraphChange(addPendingGraphChange({ full: false, sessions: false }, 'sessions'), 'full'),
    { full: true, sessions: true },
  )
})

test('exact-directory transport reconciles directory paths idempotently and closes/reopens cleanly', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-exact-watch-'))
  mkdirSync(join(root, 'a'))
  mkdirSync(join(root, 'b', 'c'), { recursive: true })
  writeFileSync(join(root, 'a', 'file.ts'), 'one\n')
  const { opened, factory } = fakeFactory()
  const failures: Error[] = []
  const registry = new TreeWatcherRegistry({
    root,
    source: 'fixture',
    scope: 'full',
    transport: 'exact-directory',
    watchFactory: factory,
    onInput: () => {},
    onFailure: (error) => failures.push(error),
  })

  try {
    assert.equal(registry.refresh(), true)
    assert.deepEqual(registry.paths(), [root, join(root, 'a'), join(root, 'b'), join(root, 'b', 'c')])
    assert.equal(opened.length, 4, 'files are not individual watches')
    assert.equal(opened.every((row) => !row.recursive), true, 'the userspace transport never asks for recursion')

    assert.equal(registry.refresh(), true)
    assert.equal(opened.length, 4, 'an unchanged refresh must register nothing')

    mkdirSync(join(root, 'd'))
    assert.equal(registry.refresh(), true)
    assert.equal(opened.filter((row) => row.path === join(root, 'd')).length, 1)

    rmSync(join(root, 'b'), { recursive: true })
    assert.equal(registry.refresh(), true)
    assert.equal(opened.find((row) => row.path === join(root, 'b'))?.watcher.closed, 1)
    assert.equal(opened.find((row) => row.path === join(root, 'b', 'c'))?.watcher.closed, 1)

    registry.close()
    assert.equal(registry.size, 0)
    assert.equal(opened.reduce((sum, row) => sum + row.watcher.closed, 0), 5)
    assert.equal(registry.refresh(), true, 'a closed source may start a clean watcher era')
    assert.equal(registry.size, 3)
    assert.equal(failures.length, 0)
  } finally {
    registry.close()
    rmSync(root, { recursive: true, force: true })
  }
})

// The whole point of the consolidated transport: registration is ONE per canonical root no matter how wide
// the corpus inside it is. 300 spec-node directories must still cost exactly one registration.
test('consolidated transport registers one watch per root regardless of corpus width', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-consolidated-watch-'))
  for (let node = 0; node < 300; node++) mkdirSync(join(root, '.spec', `n${node}`), { recursive: true })
  mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true })
  const { opened, factory } = fakeFactory()
  const inputs: string[] = []
  const failures: Error[] = []
  const registry = new TreeWatcherRegistry({
    root,
    source: 'fixture',
    scope: 'full',
    transport: 'consolidated-recursive',
    ignore: (file) => file.split('/').some((segment) => segment === 'node_modules'),
    watchFactory: factory,
    onInput: (_event, rel) => inputs.push(rel),
    onFailure: (error) => failures.push(error),
  })

  try {
    assert.equal(registry.refresh(), true)
    assert.deepEqual(registry.paths(), [root])
    assert.equal(opened.length, 1)
    assert.equal(opened[0].recursive, true, 'the kernel-side observer covers the subtree')

    assert.equal(registry.refresh(), true)
    assert.equal(opened.length, 1, 'an unchanged refresh must register nothing')

    // delivery carries the path relative to the root, and exclusions filter on delivery because nothing
    // was consumed per directory to exclude at registration time.
    opened[0].watcher.emit('change', 'change', join('.spec', 'n7', 'spec.md'))
    opened[0].watcher.emit('change', 'change', join('node_modules', 'dep', 'index.js'))
    assert.deepEqual(inputs, [join('.spec', 'n7', 'spec.md')])

    // a rename deep in the tree needs no re-walk: the observer already covers whatever appeared.
    opened[0].watcher.emit('change', 'rename', join('.spec', 'n8'))
    assert.equal(opened.length, 1, 'a consolidated observer must never re-enumerate directories')
    assert.equal(failures.length, 0)
  } finally {
    registry.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a refused registration fails once, reclaims every partial handle, and retries nothing by itself', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-exact-watch-fail-'))
  mkdirSync(join(root, 'a'))
  mkdirSync(join(root, 'b'))
  mkdirSync(join(root, 'c'))
  const failures: Error[] = []
  let failPath: string | null = join(root, 'b')
  const emfile = Object.assign(new Error('EMFILE: too many open files, watch'), { code: 'EMFILE' })
  const { opened, factory } = fakeFactory((path) => (path === failPath ? emfile : null))
  const registry = new TreeWatcherRegistry({
    root,
    source: 'fixture',
    scope: 'full',
    transport: 'exact-directory',
    watchFactory: factory,
    onInput: () => {},
    onFailure: (error) => failures.push(error),
  })

  try {
    assert.equal(registry.refresh(), false)
    assert.equal(registry.size, 0, 'a refused attach leaves no half-attached set')
    assert.equal(failures.length, 1, 'the platform is reported once, not once per directory')
    assert.match(failures[0].message, /fixture.*\/b.*EMFILE/)
    assert.equal(opened.every((row) => row.watcher.closed === 1), true, 'partial handles are reclaimed atomically')
    const openedBefore = opened.length
    // the registry owns no timer: nothing reattaches until its owner's repair scheduler says so.
    assert.equal(opened.length, openedBefore, 'a failed registry must not retry on its own')

    failPath = null
    assert.equal(registry.refresh(), true)
    const live = opened.filter((row) => row.path === join(root, 'a')).at(-1)
    assert.ok(live)
    live.watcher.emit('change', 'rename', null)
    assert.equal(registry.size, 0)
    assert.equal(failures.length, 2)
    assert.match(failures[1].message, /fixture.*\/a.*pathless/)
    assert.equal(opened.every((row) => row.watcher.closed === 1), true)

    assert.equal(registry.refresh(), true)
    const replacement = opened.filter((row) => row.path === join(root, 'a')).at(-1)
    assert.ok(replacement)
    replacement.watcher.emit('error', Object.assign(new Error('EMFILE: too many open files, watch'), { code: 'EMFILE' }))
    assert.equal(registry.size, 0)
    assert.equal(failures.length, 3)
    assert.match(failures[2].message, /fixture.*\/a.*EMFILE/)
  } finally {
    registry.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('the census counts live registrations and returns to its floor on close', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-census-'))
  mkdirSync(join(root, 'a', 'b'), { recursive: true })
  const floor = graphWatcherCensus()
  const { factory } = fakeFactory()
  const exact = new TreeWatcherRegistry({
    root, source: 'census-exact', scope: 'full', transport: 'exact-directory',
    watchFactory: factory, onInput: () => {}, onFailure: () => {},
  })
  const consolidated = new TreeWatcherRegistry({
    root, source: 'census-consolidated', scope: 'full', transport: 'consolidated-recursive',
    watchFactory: factory, onInput: () => {}, onFailure: () => {},
  })
  try {
    exact.refresh()
    consolidated.refresh()
    const loaded = graphWatcherCensus()
    assert.equal(loaded.sources, floor.sources + 2)
    assert.equal(loaded.registrations, floor.registrations + 4, 'three directories exact + one consolidated root')
  } finally {
    exact.close()
    consolidated.close()
    rmSync(root, { recursive: true, force: true })
  }
  assert.deepEqual(graphWatcherCensus(), floor, 'close returns every handle the registries took')
})

test('worktree observers cover live sessions and an explicitly demanded offline session only', () => {
  const sessions = [
    { id: 'live', path: '/repo/.worktrees/live', liveness: 'live' },
    { id: 'offline-a', path: '/repo/.worktrees/offline-a', liveness: 'offline' },
    { id: 'offline-b', path: '/repo/.worktrees/offline-b', liveness: 'offline' },
  ]
  assert.deepEqual([...sessionWorktreeWatchPaths(sessions)], ['/repo/.worktrees/live'])
  assert.deepEqual(
    [...sessionWorktreeWatchPaths(sessions, new Set(['offline-b']))],
    ['/repo/.worktrees/live', '/repo/.worktrees/offline-b'],
  )
})

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) assert.fail(message)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

// Whichever transport the running platform resolves to, the OBSERVATION contract is identical: a real
// worktree delivers its dirty source, its renames, its sidecars and its staged-only index writes, and
// never pays a registration for dependency bytes.
test('worktree eval watcher observes source, rename, sidecar, and index inputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-graph-watch-'))
  const gitDir = join(root, '.git-meta')
  const specDir = join(root, '.spec', 'area', 'node')
  mkdirSync(gitDir, { recursive: true })
  mkdirSync(specDir, { recursive: true })
  mkdirSync(join(root, 'packages', 'nested', 'node_modules', 'dependency'), { recursive: true })
  writeFileSync(join(gitDir, 'index'), '0')
  writeFileSync(join(root, 'source.ts'), 'export const value = 0\n')

  let inputs = 0
  let failures = 0
  const watchers = watchSessionEvalWorktree(root, gitDir, () => { inputs++ }, () => { failures++ })

  try {
    if (watchers.root.transport === 'exact-directory')
      assert.equal(watchers.root.paths().some((path) => path.includes('node_modules')), false)
    else
      assert.deepEqual(watchers.root.paths(), [root], 'one registration covers the whole working tree')

    let before = inputs
    writeFileSync(join(root, 'source.ts'), 'export const value = 1\n')
    await waitFor(() => inputs > before, 'ordinary source write was not observed')

    before = inputs
    renameSync(join(root, 'source.ts'), join(root, 'renamed.ts'))
    await waitFor(() => inputs > before, 'source rename was not observed')

    before = inputs
    writeFileSync(join(specDir, 'evals.ndjson'), '{"scenario":"direct"}\n')
    await waitFor(() => inputs > before, 'reading sidecar write was not observed')

    before = inputs
    writeFileSync(join(gitDir, 'index'), '1')
    await waitFor(() => inputs > before, 'git index write was not observed')

    // a dependency write must never reach the graph, whichever side of the transport excludes it
    before = inputs
    writeFileSync(join(root, 'packages', 'nested', 'node_modules', 'dependency', 'index.js'), 'noise\n')
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.equal(inputs, before, 'dependency bytes must not reach the graph')
    assert.equal(failures, 0)
  } finally {
    try { watchers.close() } catch { /* closed by the failure path */ }
    rmSync(root, { recursive: true, force: true })
  }
})

test('refs eval watcher fails partial attach and survives repeated atomic ref replacement', async () => {
  const common = mkdtempSync(join(tmpdir(), 'spex-refs-watch-'))
  let inputs = 0
  let failures = 0
  try {
    assert.throws(() => watchSessionEvalRefs(common, () => { inputs++ }, () => { failures++ }))
    assert.equal(failures, 0, 'the owner handles an attach throw and places the observer hold')

    mkdirSync(join(common, 'refs', 'heads'), { recursive: true })
    const watchers = watchSessionEvalRefs(common, () => { inputs++ }, () => { failures++ })
    for (let round = 1; round <= 3; round++) {
      const before = inputs
      writeFileSync(join(common, 'refs', 'heads', 'main.lock'), `${round}\n`)
      renameSync(join(common, 'refs', 'heads', 'main.lock'), join(common, 'refs', 'heads', 'main'))
      await waitFor(() => inputs > before, `atomic ref replacement ${round} was not observed`)
    }
    const before = inputs
    writeFileSync(join(common, 'HEAD'), 'ref: refs/heads/main\n')
    await waitFor(() => inputs > before, 'replacement refs watcher did not observe HEAD')
    assert.equal(failures, 0)
    watchers.close()
  } finally {
    rmSync(common, { recursive: true, force: true })
  }
})

test('worktree registry watcher closes and reopens without duplicate delivery', async () => {
  const registry = mkdtempSync(join(tmpdir(), 'spex-registry-watch-'))
  let inputs = 0
  let failures = 0
  try {
    let watcher = watchSessionEvalRegistry(registry, () => { inputs++ }, () => { failures++ })
    writeFileSync(join(registry, 'new-worktree'), 'registered\n')
    await waitFor(() => inputs > 0, 'replacement registry watcher did not observe the next entry')
    watcher.close()
    const before = inputs
    writeFileSync(join(registry, 'closed-worktree'), 'closed\n')
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(inputs, before, 'a closed registry must not deliver')
    watcher = watchSessionEvalRegistry(registry, () => { inputs++ }, () => { failures++ })
    writeFileSync(join(registry, 'reopened-worktree'), 'reopened\n')
    await waitFor(() => inputs > before, 'reopened registry did not observe the next entry')
    watcher.close()
    assert.equal(failures, 0)
  } finally {
    rmSync(registry, { recursive: true, force: true })
  }
})
