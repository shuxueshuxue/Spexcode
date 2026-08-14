import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tsxBin } from './tsx-bin.js'

const SRC = dirname(fileURLToPath(import.meta.url))
const CLI = join(SRC, 'cli.ts')
const TSX = tsxBin(join(SRC, '..'))

test('graph rejects a non-Git workspace with one actionable message and no runtime stack', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'spex-nongit-graph-'))
  try {
    const result = spawnSync(process.execPath, [TSX, CLI, 'graph', '--json'], { cwd: workspace, encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, `spex: workspace is not a Git repository: ${workspace}. Run \`git init\` in that directory, then retry.\n`)
    assert.doesNotMatch(result.stderr, /at node:internal|Command failed:|cannot derive history events/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('the cached graph entrance rejects the same non-Git workspace before layout reads', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'spex-nongit-cache-'))
  const cwd = process.cwd()
  try {
    process.chdir(workspace)
    const { readBoard } = await import('./graphCache.js')
    await assert.rejects(readBoard(), (error: unknown) => {
      assert.equal((error as Error).name, 'GitWorkspaceError')
      assert.equal((error as Error).message, `workspace is not a Git repository: ${workspace}. Run \`git init\` in that directory, then retry.`)
      return true
    })
  } finally {
    process.chdir(cwd)
    rmSync(workspace, { recursive: true, force: true })
  }
})
