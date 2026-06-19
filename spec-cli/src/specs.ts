import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, basename } from 'node:path'
import { repoRoot, historyIndex, rowsFor, statsFor, diffstat, driftIndex, driftFor } from './git.js'

// @@@ tree from filesystem - the spec tree IS the directory tree under .spec; a node is any
// directory holding a spec.md, its parent is the nearest ancestor that also holds one.
const ROOT = repoRoot()
const SPEC_DIR = join(ROOT, '.spec')

type FmValue = string | string[]
type Raw = { id: string; parent: string | null; relPath: string; fm: Record<string, FmValue>; body: string }

// @@@ frontmatter - line-based, deliberately tiny. Scalars are `key: value`; a key with an empty
// value followed by `- item` lines becomes a list (that's how `code:` declares its governed files).
function parseFrontmatter(src: string) {
  const fm: Record<string, FmValue> = {}
  let body = src
  const m = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (m) {
    let key: string | null = null
    for (const line of m[1].split('\n')) {
      const item = line.match(/^\s*-\s+(.*)$/)
      if (item && key) {
        if (!Array.isArray(fm[key])) fm[key] = fm[key] ? [fm[key] as string] : []
        ;(fm[key] as string[]).push(item[1].trim())
        continue
      }
      const i = line.indexOf(':')
      if (i > 0) { key = line.slice(0, i).trim(); fm[key] = line.slice(i + 1).trim() }
    }
    body = m[2]
  }
  return { fm, body }
}

const str = (v: FmValue | undefined, d = '') => (Array.isArray(v) ? v.join(', ') : v ?? d)
const list = (v: FmValue | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : [])

function walk(dir: string, parent: string | null, acc: Raw[]) {
  let myId = parent
  if (existsSync(join(dir, 'spec.md'))) {
    myId = basename(dir)
    const relPath = relative(ROOT, join(dir, 'spec.md'))
    const { fm, body } = parseFrontmatter(readFileSync(join(dir, 'spec.md'), 'utf8'))
    acc.push({ id: myId, parent, relPath, fm, body })
  }
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(join(dir, e.name), myId, acc)
  }
}

function raws(): Raw[] {
  const acc: Raw[] = []
  if (existsSync(SPEC_DIR)) walk(SPEC_DIR, null, acc)
  return acc
}

export function loadSpecs() {
  const idx = historyIndex(ROOT) // one walk (cached on HEAD); every node below is a pure lookup
  const didx = driftIndex(ROOT)  // one git-log walk (cached on HEAD); driftFor() is then pure
  return raws().map((r) => {
    const h = rowsFor(idx, r.relPath)
    // @@@ real session attribution - the node's session IS the Claude Code session that authored its
    // latest version (the commit's `Session:` trailer, auto-stamped from CLAUDE_CODE_SESSION_ID). Since
    // worktree sessions launch with `--session-id <that same id>`, this links a node to the live session
    // in the dashboard. Frontmatter `session:` is only a fallback for nodes with no committed history.
    const fmSession = str(r.fm.session)
    const session = h[0]?.session || (fmSession && fmSession !== 'null' ? fmSession : null)
    // @@@ drift - rigorous, by git ancestry: per governed file, how many commits it has moved AHEAD of
    // this spec's latest version commit (S = h[0].hash). driftFiles lists the laggards; drift is the
    // total "commits behind". 0 = the spec still describes its code. Replaces the old date-compare guess.
    const code = list(r.fm.code)
    const S = h[0]?.hash || ''
    const driftFiles = code
      .map((f) => ({ file: f, behind: driftFor(didx, S, f) }))
      .filter((d) => d.behind > 0)
    return {
      id: r.id,
      parent: r.parent,
      path: r.relPath,
      title: str(r.fm.title, r.id),
      status: str(r.fm.status, 'pending'),
      session,
      hue: Number(str(r.fm.hue, '210')),
      desc: str(r.fm.desc),
      code,
      version: h.length,
      reason: h[0]?.reason || '',
      drift: driftFiles.reduce((a, d) => a + d.behind, 0),
      driftFiles,
      // @@@ evidence - metadata links to A->B proof frames, read from the spec's frontmatter
      // (`evidence:` list). The backend is the source of truth here too — the dashboard never
      // fabricates these. Empty until the yatsu package records real captures and writes the links.
      evidence: list(r.fm.evidence),
      body: r.body.trim(),
    }
  })
}

// @@@ specHistory - per-node version timeline, each row's line-diff SCOPED to this node: its spec.md
// (rename-followed via specStats) PLUS the code it governs (git show on the stable code paths). So a
// version reads as the lines it changed in THIS node's world, not the whole repo-wide commit. The
// two sources are added because spec.md needs rename-following that `git show -- <path>` can't do.
export function specHistory(id: string) {
  const node = raws().find((r) => r.id === id)
  if (!node) return []
  const idx = historyIndex(ROOT)
  const codePaths = list(node.fm.code)
  const sStats = statsFor(idx, node.relPath)
  return rowsFor(idx, node.relPath).map((v) => {
    const s = sStats.get(v.hash) ?? { additions: 0, deletions: 0, files: 0 }
    const c = codePaths.length ? diffstat(ROOT, v.hash, codePaths) : { additions: 0, deletions: 0, files: 0 }
    return { ...v, additions: s.additions + c.additions, deletions: s.deletions + c.deletions, files: s.files + c.files }
  })
}
