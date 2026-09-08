import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

import { fromForge } from './issues.js'

test('fromForge preserves platform labels and their display colors on the unified Issue', () => {
  const [issue] = fromForge({
    host: 'gitlab',
    state: {
      issues: [{
        number: 42,
        title: 'Retain platform labels',
        body: '',
        url: 'https://gitlab.example/acme/spex/-/issues/42',
        state: 'open',
        labels: [
          { name: 'bug', color: '#d73a4a', textColor: '#ffffff' },
          { name: 'triage' },
        ],
        author: 'octavia',
        createdAt: '2026-08-09T00:00:00Z',
        comments: [],
      }],
      prs: [],
    },
  }, [])

  assert.deepEqual(issue.labels, [
    { name: 'bug', color: '#d73a4a', textColor: '#ffffff' },
    { name: 'triage' },
  ])
})


// The landing merge is authored in a TEMPORARY DETACHED WORKTREE ([[local-issues]] and the merge skill's
// step 4), so the post-merge nudge normally runs where a store write is refused. It must not name a command
// that tree rejects; from the trunk itself nothing changes. `repoRoot()` is resolved once per process, so the
// predicate is only observable across real invocations — the same shape the hook uses.
test('post-merge nudge names `issue open` only where the store would accept it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-nudge-tree-'))
  const trunk = join(dir, 'trunk')
  const linked = join(dir, 'landing')
  const cli = join(import.meta.dirname, 'cli.ts')
  const run = (cwd: string) =>
    execFileSync('npx', ['tsx', cli, 'internal', 'nudge', 'node/demo'], { cwd, encoding: 'utf8' })
  try {
    mkdirSync(trunk, { recursive: true })
    execFileSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: trunk })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: trunk })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: trunk })
    mkdirSync(join(trunk, '.spec', 'project'), { recursive: true })
    writeFileSync(join(trunk, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\nScope.\n')
    execFileSync('git', ['add', '-A'], { cwd: trunk })
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: trunk })
    execFileSync('git', ['worktree', 'add', '-q', '--detach', linked, 'main'], { cwd: trunk })

    const fromTrunk = run(trunk)
    assert.match(fromTrunk, /spex issue open/, 'the trunk can commit, so it still offers the open')

    const fromLinked = run(linked)
    assert.doesNotMatch(fromLinked, /spex issue open/, 'a tree that refuses the write must not ask for it')
    assert.match(fromLinked, /does NOT work from this tree/)
    assert.match(fromLinked, /spex issue ls/, 'reads still resolve to the trunk, so keep offering the read')
    assert.match(fromLinked, /CLOSE what you finished/, 'the close half is unaffected')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
