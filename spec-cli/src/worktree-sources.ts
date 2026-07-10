import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { git } from './git.js'

// @@@ worktree-sources ([[private-overlay]]) - a fresh session worktree checks out only TRACKED content, and
// private mode keeps `.spec` + `spexcode.json` untracked (spexcode.local.json is untracked in BOTH modes) —
// so git alone hands a dispatched agent a worktree with NO spec tree: every hook handler script is absent
// (the dispatcher silently runs nothing), spex sees zero nodes, and the gate re-renders per event over empty
// config roots. Seed those sources from the main checkout instead, each by its semantics:
//   - PROJECT state (`.spec`, `spexcode.json`) is LINKED — shared write-through is the point (a spec write
//     from inside a private worktree lands directly in the main tree).
//   - HOST state (`spexcode.local.json`) is COPIED — the worker reads the same mode/launchers snapshot, but
//     its writes land on its own copy and die with the worktree, never on the host's real config (a worker
//     once wrote "its" test config through the old symlink and wiped the host's launchers → dispatch 401s).
// On a default-mode repo the checkout already carries the tracked sources, so each guard no-ops — one
// mechanism, never a mode branch. A failure degrades that worker (no hooks, no specs), so it is reported,
// not swallowed.
export function linkUntrackedSpecSources(main: string, wt: string): void {
  const seeded: string[] = []
  for (const f of ['.spec', 'spexcode.json', 'spexcode.local.json']) {
    try {
      if (!existsSync(join(main, f)) || existsSync(join(wt, f))) continue
      if (f === 'spexcode.local.json') copyFileSync(join(main, f), join(wt, f))
      else symlinkSync(join(main, f), join(wt, f))
      seeded.push(f)
    } catch (e) {
      console.error(`spexcode: could not seed ${f} from ${main} into worktree ${wt} — that worker runs without it (${e})`)
    }
  }
  hideSeededFromGit(wt, seeded)
}

// what we seed, we hide: a seeded entry git still sees is force-add bait (a real PR once carried .spec into
// a product repo). `.git/info/exclude` lives in the COMMON git dir, so one write hides the entry in every
// linked worktree AND the main checkout — and materialize's private-mode `.spec/` pattern is dir-only, which
// a worktree's .spec SYMLINK never matches, so this is also the self-heal for a half-configured repo. Only
// entries seeded by THIS call and reported un-ignored by `git check-ignore` are written: idempotent across
// dispatches, and a default-mode repo (tracked sources never seeded, local.json already gitignored) writes
// nothing.
function hideSeededFromGit(wt: string, seeded: string[]): void {
  for (const f of seeded) {
    try {
      if (isIgnored(wt, f)) continue
      const exclude = join(git(['-C', wt, 'rev-parse', '--path-format=absolute', '--git-common-dir']).trim(), 'info', 'exclude')
      mkdirSync(dirname(exclude), { recursive: true })
      const cur = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
      appendFileSync(exclude, `${cur && !cur.endsWith('\n') ? '\n' : ''}${f}\n`)
    } catch (e) {
      console.error(`spexcode: could not hide seeded ${f} in the shared info/exclude for ${wt} — it will show untracked there (${e})`)
    }
  }
}

function isIgnored(wt: string, f: string): boolean {
  try { git(['-C', wt, 'check-ignore', '-q', f]); return true }
  catch (e: any) {
    if (e?.status === 1) return false   // check-ignore's documented "not ignored" exit
    throw e
  }
}
