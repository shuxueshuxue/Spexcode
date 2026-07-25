import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The Stop gate's commit check ([[state]]) judges the PROPOSAL it was given, in a real git repo — the two
// conditions are not one boolean: a dirty tree falsifies BOTH declarations' "the work is committed" claim,
// while 0-ahead-of-base contradicts only `merge`. Gating `nothing` on ahead-of-base left an already-merged
// lane one way to pause for the human: an empty commit, i.e. a lie in git history to satisfy an honesty check.

const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

// the product's real shape: a MAIN checkout that keeps `main` checked out, plus a LINKED worktree on the node
// branch. It matters — mainBranch() detects the trunk from the checkout, so a bare repo whose only checkout
// sits on the node branch resolves the base to that same branch and `base..HEAD` is trivially 0 (the fixture
// artifact this shape avoids: a test that passes while measuring nothing).
function repo(): { main: string; wt: string } {
  const main = mkdtempSync(join(tmpdir(), 'spex-gate-'))
  git(main, ['init', '-q', '-b', 'main'])
  git(main, ['config', 'user.email', 't@t'])
  git(main, ['config', 'user.name', 't'])
  writeFileSync(join(main, 'seed.txt'), 'seed\n')
  git(main, ['add', '.'])
  git(main, ['commit', '-qm', 'seed'])
  const wt = join(main, 'wt')
  git(main, ['worktree', 'add', '-q', '-b', 'node/example', wt])
  return { main, wt }
}

// run the gate the way the hook runs it: `spex internal commit-gate [merge|nothing]` from the worktree
function gate(cwd: string, proposal?: string): { ok: boolean; out: string } {
  const cli = join(import.meta.dirname, 'cli.ts')
  try {
    const out = execFileSync('npx', ['tsx', cli, 'internal', 'commit-gate', ...(proposal ? [proposal] : [])], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, out: out.trim() }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string }
    return { ok: false, out: `${err.stdout || ''}${err.stderr || ''}`.trim() }
  }
}

test('a clean branch with nothing ahead may propose NOTHING but not MERGE', () => {
  const { main, wt: dir } = repo()   // clean, 0 commits ahead of main
  try {
    const nothing = gate(dir, 'nothing')
    assert.equal(nothing.ok, true, `propose-nothing must pass on a clean 0-ahead branch, got: ${nothing.out}`)

    const merge = gate(dir, 'merge')
    assert.equal(merge.ok, false, 'propose-merge must still be refused with nothing to land')
    assert.match(merge.out, /0 commits ahead/)
    // the refusal names the honest alternative rather than implying an empty commit
    assert.match(merge.out, /propose nothing/)
  } finally { rmSync(main, { recursive: true, force: true }) }
})

test('an uncommitted tree refuses BOTH proposals — the shared claim is that the work is committed', () => {
  const { main, wt: dir } = repo()
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src', 'work.ts'), 'export const x = 1\n')   // genuine uncommitted work
  try {
    for (const proposal of ['merge', 'nothing']) {
      const r = gate(dir, proposal)
      assert.equal(r.ok, false, `${proposal} must be refused with a dirty tree`)
      assert.match(r.out, /uncommitted changes/)
      assert.match(r.out, /work\.ts/)
    }
  } finally { rmSync(main, { recursive: true, force: true }) }
})

test('committed work ahead of base passes either proposal, and a bare call still means merge', () => {
  const { main, wt: dir } = repo()
  writeFileSync(join(dir, 'landed.txt'), 'work\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-qm', 'spec: example — committed work'])
  try {
    assert.equal(gate(dir, 'merge').ok, true)
    assert.equal(gate(dir, 'nothing').ok, true)
    // the hook passes the proposal explicitly; a bare call keeps the strict (merge) reading
    assert.equal(gate(dir).ok, true)
  } finally { rmSync(main, { recursive: true, force: true }) }
})
