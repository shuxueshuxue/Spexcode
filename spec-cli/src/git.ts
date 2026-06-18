import { execFileSync } from 'node:child_process'

// @@@ git is the database - a spec's version history IS the git log of its spec.md.
// %s (subject) = the reason for change; a `Session:` trailer = the attribution.
const US = '\x1f', RS = '\x1e'

export function repoRoot(): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  } catch {
    return process.cwd()
  }
}

export type Version = { hash: string; date: string; reason: string; session: string | null }

export function history(root: string, relPath: string): Version[] {
  let out = ''
  try {
    out = execFileSync('git', ['-C', root, 'log', `--format=%H${US}%aI${US}%s${US}%b${RS}`, '--follow', '--', relPath], { encoding: 'utf8' })
  } catch {
    return []
  }
  return out.split(RS).map((r) => r.trim()).filter(Boolean).map((rec) => {
    const [hash, date, reason, body = ''] = rec.split(US)
    const m = body.match(/Session:\s*(\S+)/)
    return { hash, date, reason, session: m ? m[1] : null }
  })
}
