import { execFileSync } from 'node:child_process'

// @@@ git is the database - a spec's version history IS the git log of its spec.md.
// %s (subject) = the reason for change; a `Session:` trailer = the attribution.
const US = '\x1f', RS = '\x1e'

// @@@ clean git env - git hooks export GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE, and those override
// git's normal repo discovery. Inside a hook that makes `rev-parse --show-toplevel` resolve to the
// cwd instead of the real worktree root — so repoRoot() pointed at spec-cli/ and loaded zero specs.
// Strip them so EVERY git call we make discovers the repo from the filesystem, hook or not.
export function git(args: string[]): string {
  const env = { ...process.env }
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_OBJECT_DIRECTORY
  return execFileSync('git', args, { encoding: 'utf8', env })
}

export function repoRoot(): string {
  try {
    return git(['rev-parse', '--show-toplevel']).trim()
  } catch {
    return process.cwd()
  }
}

export type Version = { hash: string; date: string; reason: string; session: string | null }

export function history(root: string, relPath: string): Version[] {
  let out = ''
  try {
    out = git(['-C', root, 'log', `--format=%H${US}%aI${US}%s${US}%b${RS}`, '--follow', '--', relPath])
  } catch {
    return []
  }
  return out.split(RS).map((r) => r.trim()).filter(Boolean).map((rec) => {
    const [hash, date, reason, body = ''] = rec.split(US)
    const m = body.match(/Session:\s*(\S+)/)
    return { hash, date, reason, session: m ? m[1] : null }
  })
}
