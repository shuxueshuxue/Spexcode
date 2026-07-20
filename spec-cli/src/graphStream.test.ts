import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { scheduleWorktreeResubscribe, watchSessionEvalWorktree } from './graphStream.js'

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
  const attempted = new Set<string>()
  let watchers: ReturnType<typeof watchSessionEvalWorktree>
  const attach = () => {
    watchers = watchSessionEvalWorktree(
      root,
      gitDir,
      () => { inputs++ },
      () => {
        failures++
        scheduleWorktreeResubscribe('fixture', attempted, () => {
          attach()
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

    before = inputs
    writeFileSync(join(root, 'renamed.ts'), 'export const value = 2\n')
    await waitFor(() => inputs > before, 'resubscribed watcher did not observe the next source write')
  } finally {
    try { watchers!.root.close() } catch { /* closed by the failure path */ }
    try { watchers!.index.close() } catch { /* closed by the failure path */ }
    rmSync(root, { recursive: true, force: true })
  }
})
