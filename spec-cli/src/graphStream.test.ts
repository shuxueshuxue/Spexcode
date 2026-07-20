import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  scheduleWorktreeResubscribe,
  watchSessionEvalRefs,
  watchSessionEvalRegistry,
  watchSessionEvalWorktree,
} from './graphStream.js'

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
  writeFileSync(join(gitDir, 'index'), '0')
  writeFileSync(join(root, 'source.ts'), 'export const value = 0\n')

  let inputs = 0
  let failures = 0
  let missedWindowWrites = 0
  let authoritativeRescans = 0
  const attempted = new Set<string>()
  let watchers: ReturnType<typeof watchSessionEvalWorktree>
  const attach = () => {
    watchers = watchSessionEvalWorktree(
      root,
      gitDir,
      () => { inputs++ },
      () => {
        failures++
        // The mutation is deliberately after the old watcher closed and before its replacement attaches.
        writeFileSync(join(root, 'renamed.ts'), 'export const value = 2\n')
        missedWindowWrites++
        scheduleWorktreeResubscribe('fixture', attempted, () => {
          attach()
          authoritativeRescans++
          attempted.delete('fixture')
        })
      },
    )
  }
  attach()

  try {
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

    const failedRoot = watchers!.root
    ;(failedRoot as unknown as { emit: (...args: unknown[]) => void })
      .emit('change', 'rename', null)
    await waitFor(() => failures === 1, 'pathless watcher event did not enter failure recovery')
    await waitFor(() => watchers!.root !== failedRoot, 'failed worktree watcher was not immediately resubscribed')
    assert.equal(missedWindowWrites, 1)
    assert.equal(authoritativeRescans, 1, 'replacement attachment must authorize one missed-window rescan')

    before = inputs
    writeFileSync(join(root, 'renamed.ts'), 'export const value = 3\n')
    await waitFor(() => inputs > before, 'resubscribed watcher did not observe the next source write')
  } finally {
    try { watchers!.root.close() } catch { /* closed by the failure path */ }
    try { watchers!.index.close() } catch { /* closed by the failure path */ }
    rmSync(root, { recursive: true, force: true })
  }
})

test('refs eval watcher fails partial attach and recovers pathless and error events', async () => {
  const common = mkdtempSync(join(tmpdir(), 'spex-refs-watch-'))
  let inputs = 0
  let failures = 0
  try {
    assert.throws(() => watchSessionEvalRefs(common, () => { inputs++ }, () => { failures++ }))
    assert.equal(failures, 0, 'the owner handles an attach throw and places the observer hold')

    mkdirSync(join(common, 'refs', 'heads'), { recursive: true })
    let watchers = watchSessionEvalRefs(common, () => { inputs++ }, () => { failures++ })
    ;(watchers[0] as unknown as { emit: (...args: unknown[]) => void }).emit('change', 'rename', null)
    await waitFor(() => failures === 1, 'pathless refs event did not enter failure recovery')

    watchers = watchSessionEvalRefs(common, () => { inputs++ }, () => { failures++ })
    writeFileSync(join(common, 'refs', 'heads', 'main'), 'one\n')
    await waitFor(() => inputs > 0, 'loose ref movement was not observed')

    const failed = watchers[0]
    ;(failed as unknown as { emit: (...args: unknown[]) => void }).emit('error', new Error('overflow'))
    await waitFor(() => failures === 2, 'refs watcher error did not enter failure recovery')

    watchers = watchSessionEvalRefs(common, () => { inputs++ }, () => { failures++ })
    const before = inputs
    writeFileSync(join(common, 'HEAD'), 'ref: refs/heads/main\n')
    await waitFor(() => inputs > before, 'replacement refs watcher did not observe HEAD')
    for (const watcher of watchers) watcher.close()
  } finally {
    rmSync(common, { recursive: true, force: true })
  }
})

test('worktree registry watcher treats a pathless event as observer failure and reattaches', async () => {
  const registry = mkdtempSync(join(tmpdir(), 'spex-registry-watch-'))
  let inputs = 0
  let failures = 0
  try {
    let watcher = watchSessionEvalRegistry(registry, () => { inputs++ }, () => { failures++ })
    ;(watcher as unknown as { emit: (...args: unknown[]) => void }).emit('change', 'rename', null)
    await waitFor(() => failures === 1, 'pathless registry event did not enter failure recovery')

    watcher = watchSessionEvalRegistry(registry, () => { inputs++ }, () => { failures++ })
    writeFileSync(join(registry, 'new-worktree'), 'registered\n')
    await waitFor(() => inputs > 0, 'replacement registry watcher did not observe the next entry')
    watcher.close()
  } finally {
    rmSync(registry, { recursive: true, force: true })
  }
})
