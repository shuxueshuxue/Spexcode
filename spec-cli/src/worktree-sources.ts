import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { git } from './git.js'

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
// by `git check-ignore` are written: idempotent across dispatches, and a repo whose materialize already ignores
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
