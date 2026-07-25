import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ExactTreeWatcherRegistry,
  scheduleWorktreeResubscribe,
  sessionWorktreeWatchPaths,
  watchSessionEvalRefs,
  watchSessionEvalRegistry,
  watchSessionEvalWorktree,
} from './graphStream.js'

class FakeWatcher extends EventEmitter {
  closed = 0
  close(): void { this.closed++ }
}

test('exact-tree registry reconciles directory paths idempotently and closes/reopens cleanly', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-exact-watch-'))
  mkdirSync(join(root, 'a'))
  mkdirSync(join(root, 'b', 'c'), { recursive: true })
  writeFileSync(join(root, 'a', 'file.ts'), 'one\n')
  const opened = new Map<string, FakeWatcher[]>()
  const watchFactory = ((path: string, callback: (...args: unknown[]) => void) => {
    const watcher = new FakeWatcher()
    watcher.on('change', callback)
    opened.set(path, [...(opened.get(path) ?? []), watcher])
    return watcher
  }) as unknown as typeof import('node:fs').watch
  const failures: Error[] = []
  const registry = new ExactTreeWatcherRegistry({
    root,
    source: 'fixture',
    scope: 'full',
    watchFactory,
    onInput: () => {},
    onFailure: (error) => failures.push(error),
  })

  try {
    assert.equal(registry.refresh(), true)
    assert.deepEqual(registry.paths(), [root, join(root, 'a'), join(root, 'b'), join(root, 'b', 'c')])
    assert.equal([...opened.values()].flat().length, 4, 'files are not individual watches')

    assert.equal(registry.refresh(), true)
    assert.equal([...opened.values()].flat().length, 4, 'an unchanged refresh must register nothing')

    mkdirSync(join(root, 'd'))
    assert.equal(registry.refresh(), true)
    assert.equal(opened.get(join(root, 'd'))?.length, 1)

    rmSync(join(root, 'b'), { recursive: true })
    assert.equal(registry.refresh(), true)
    assert.equal(opened.get(join(root, 'b'))?.[0].closed, 1)
    assert.equal(opened.get(join(root, 'b', 'c'))?.[0].closed, 1)

    registry.close()
    assert.equal(registry.size, 0)
    assert.equal([...opened.values()].flat().reduce((sum, watcher) => sum + watcher.closed, 0), 5)
    assert.equal(registry.refresh(), true, 'a closed source may start a clean watcher era')
    assert.equal(registry.size, 3)
    assert.equal(failures.length, 0)
  } finally {
    registry.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('exact-tree registry makes registration and runtime errors visible without a partial set', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-exact-watch-fail-'))
  mkdirSync(join(root, 'a'))
  mkdirSync(join(root, 'b'))
  const opened = new Map<string, FakeWatcher[]>()
  const failures: Error[] = []
  let failPath: string | null = join(root, 'b')
  const watchFactory = ((path: string, callback: (...args: unknown[]) => void) => {
    if (path === failPath) throw new Error('fixture ENOSPC')
    const watcher = new FakeWatcher()
    watcher.on('change', callback)
    opened.set(path, [...(opened.get(path) ?? []), watcher])
    return watcher
  }) as unknown as typeof import('node:fs').watch
  const registry = new ExactTreeWatcherRegistry({
    root,
    source: 'fixture',
    scope: 'full',
    watchFactory,
    onInput: () => {},
    onFailure: (error) => failures.push(error),
  })

  try {
    assert.equal(registry.refresh(), false)
    assert.equal(registry.size, 0)
    assert.match(failures[0].message, /fixture.*\/b.*ENOSPC/)
    assert.equal([...opened.values()].flat().every((watcher) => watcher.closed === 1), true)

    failPath = null
    assert.equal(registry.refresh(), true)
    const live = opened.get(join(root, 'a'))?.at(-1)
    assert.ok(live)
    live.emit('change', 'rename', null)
    assert.equal(registry.size, 0)
    assert.equal(failures.length, 2)
    assert.match(failures[1].message, /fixture.*\/a.*pathless/)
    assert.equal([...opened.values()].flat().every((watcher) => watcher.closed === 1), true)

    assert.equal(registry.refresh(), true)
    const replacement = opened.get(join(root, 'a'))?.at(-1)
    assert.ok(replacement)
    replacement.emit('error', new Error('fixture overflow'))
    assert.equal(registry.size, 0)
    assert.equal(failures.length, 3)
    assert.match(failures[2].message, /fixture.*\/a.*overflow/)
  } finally {
    registry.close()
    rmSync(root, { recursive: true, force: true })
  }
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
  let watchers: ReturnType<typeof watchSessionEvalWorktree>
  const attach = () => {
    watchers = watchSessionEvalWorktree(
      root,
      gitDir,
      () => { inputs++ },
      () => { failures++ },
    )
  }
  attach()

  try {
    assert.equal(watchers!.root.paths().some((path) => path.includes('node_modules')), false)
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
    assert.equal(failures, 0)
  } finally {
    try { watchers!.root.close() } catch { /* closed by the failure path */ }
    try { watchers!.index.close() } catch { /* closed by the failure path */ }
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

test('worktree resubscription remains scheduled after a transient attach failure', async () => {
  const scheduled = new Set<string>()
  let attempts = 0
  let recovered = false
  const retry = () => {
    attempts++
    if (attempts === 1) {
      // The first replacement attach observed ENOSPC. Its owner catches that failure and schedules again.
      assert.equal(scheduleWorktreeResubscribe('fixture', scheduled, retry), true)
      return
    }
    recovered = true
  }

  assert.equal(scheduleWorktreeResubscribe('fixture', scheduled, retry), true)
  assert.equal(scheduleWorktreeResubscribe('fixture', scheduled, retry), false, 'only one retry may be pending')
  await waitFor(() => recovered, 'transient watcher failure never reached a later resubscription')
  assert.equal(attempts, 2)
  assert.equal(scheduled.size, 0)
})
