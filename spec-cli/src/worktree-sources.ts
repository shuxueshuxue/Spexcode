import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { git } from './git.js'

// @@@ worktree-sources ([[render-policy]]) - a fresh session worktree is fed by THREE transports, one per
// source kind, and the kind decides the transport — never a mode branch:
//   - TRACKED project state (`.spec`, `spexcode.json`) arrives by GIT CHECKOUT: the sources are always
//     tracked (git is the database), so `git worktree add` alone delivers them. No symlink — a link is a
//     WRITE-SEMANTICS declaration (write-through to the main tree), and spec writes go back through the
//     branch/merge ritual, not through a side channel.
//   - RENDERS (contract blocks, shims, skills) are DERIVED — transported by re-render, not by link or copy:
//     sessions.ts materializes into the worktree at creation, and the git-native anchors (pre-commit /
//     post-checkout / post-merge — [[commit-surgery]]) re-render on change.
//   - HOST state (`spexcode.local.json`, machine-local and never tracked) is COPIED — a snapshot: the worker
//     reads the same launchers/policy the host had at dispatch, but its writes land on its own copy and die
//     with the worktree, never on the host's real config (a worker once wrote "its" test config through the
//     old symlink and wiped the host's launchers → every later dispatch 401'd).
// This module owns only the third transport (plus hiding what it seeds). A failure degrades that worker
// (default launchers/policy), so it is reported, not swallowed.
export function seedWorktreeHostState(main: string, wt: string): void {
  const f = 'spexcode.local.json'
  try {
    if (!existsSync(join(main, f)) || existsSync(join(wt, f))) return
    copyFileSync(join(main, f), join(wt, f))
  } catch (e) {
    console.error(`spexcode: could not seed ${f} from ${main} into worktree ${wt} — that worker runs on defaults (${e})`)
    return
  }
  hideSeededFromGit(wt, [f])
}

// what we seed, we hide: a seeded entry git still sees is force-add bait (a real PR once carried seeded
// files into a product repo). `.git/info/exclude` lives in the COMMON git dir, so one write hides the entry
// in every linked worktree AND the main checkout. Only entries seeded by THIS call and reported un-ignored
// by `git check-ignore` are written: idempotent across dispatches, and a repo whose render already ignores
// the overlay (materialize's block under any policy) writes nothing — the self-heal for a half-configured repo.
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
