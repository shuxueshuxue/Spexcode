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

// @@@ three-part body - a spec body may be authored as three clearly-labelled parts, each with a
// different owner and change-cadence:
//   raw source    (human) — the short, rarely-changed human intent/decisions; editing it needs human
//                            approval. This is the ground truth the other two parts must satisfy.
//   expanded spec (agent) — the detailed BEHAVIORAL understanding (not implementation); versioned
//                            often, but must always still match the raw source.
//   current state (agent) — split in two: `description` (what the code does now / progress / what's
//                            unimplemented) and `verdict` (why code & spec are NOT drifted, and a
//                            confirmation the code did not drive the spec in reverse).
// Detected by `## raw source` / `## expanded spec` / `## current state` level-2 headings; the current
// state's two pieces are `### description` (alias `### progress`) and `### verdict`. A body WITHOUT
// these headings parses to null — the dashboard then renders the whole body as before (back-compat).
// These are STRUCTURE headings, not `## vN` changelog headings, so `spex lint`'s living rule is happy.
export type SpecParts = {
  rawSource: string
  expandedSpec: string
  currentState: { description: string; verdict: string }
}
const PART_ALIASES: Record<string, 'rawSource' | 'expandedSpec' | 'currentState'> = {
  'raw source': 'rawSource',
  'expanded spec': 'expandedSpec',
  'current state': 'currentState',
}
function parseParts(body: string): SpecParts | null {
  const acc = { rawSource: [] as string[], expandedSpec: [] as string[], description: [] as string[], verdict: [] as string[] }
  let cur: 'rawSource' | 'expandedSpec' | 'currentState' | null = null
  let sub: 'description' | 'verdict' = 'description'
  let inFence = false
  let any = false
  for (const line of body.split('\n')) {
    const fence = /^\s*```/.test(line)
    if (!inFence && !fence) {
      const h2 = line.match(/^##\s+(.+?)\s*$/)   // exactly two hashes — `###` won't match
      const h3 = line.match(/^###\s+(.+?)\s*$/)
      if (h2) {
        const key = PART_ALIASES[h2[1].trim().toLowerCase()]
        if (key) { cur = key; sub = 'description'; any = true; continue }
        // an unrecognized `## …` heading is just content of the current part — fall through.
      } else if (h3 && cur === 'currentState') {
        // lenient on trailing text — `### verdict — not drifted` still keys on its leading word.
        const s = h3[1].trim().toLowerCase()
        if (s.startsWith('description') || s.startsWith('progress')) { sub = 'description'; continue }
        if (s.startsWith('verdict')) { sub = 'verdict'; continue }
      }
    }
    if (fence) inFence = !inFence
    if (cur === 'rawSource') acc.rawSource.push(line)
    else if (cur === 'expandedSpec') acc.expandedSpec.push(line)
    else if (cur === 'currentState') (sub === 'verdict' ? acc.verdict : acc.description).push(line)
  }
  if (!any) return null
  const t = (a: string[]) => a.join('\n').trim()
  return { rawSource: t(acc.rawSource), expandedSpec: t(acc.expandedSpec), currentState: { description: t(acc.description), verdict: t(acc.verdict) } }
}

export type DerivedStatus = 'pending' | 'active' | 'merged' | 'drift'

// @@@ deriveStatus - a node's status is DERIVED, never hand-written. Four states, in precedence:
//   active  - an unmerged managed worktree has pending ops on this node (live, in-flight work).
//             Only buildBoard knows the overlay, so /api/specs (no overlay) never reports active.
//   drift   - governed code has moved ahead of the spec's latest version (drift > 0) — maybe stale.
//   merged  - has committed version(s) on main and is in sync.
//   pending - no committed version yet (version 0).
// Frontmatter `status` is kept ONLY as a fallback: when git is unreadable every node would collapse
// to version 0 / pending, so a node that DECLARED a status still shows that intent instead.
export function deriveStatus(d: { version: number; drift: number; hasOverlay?: boolean; fmStatus?: string }): DerivedStatus {
  if (d.hasOverlay) return 'active'
  if (d.drift > 0) return 'drift'
  if (d.version > 0) return 'merged'
  const fb = d.fmStatus
  if (fb === 'active' || fb === 'merged' || fb === 'drift') return fb
  return 'pending'
}

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
    const drift = driftFiles.reduce((a, d) => a + d.behind, 0)
    const fmStatus = str(r.fm.status, '') || null
    return {
      id: r.id,
      parent: r.parent,
      path: r.relPath,
      title: str(r.fm.title, r.id),
      // @@@ derived status - computed from git (version + drift), NOT the frontmatter. Without overlay
      // knowledge here, /api/specs reports pending|drift|merged; buildBoard re-derives with the overlay
      // so a live worktree's nodes read `active`. fmStatus is carried through only as the fallback.
      status: deriveStatus({ version: h.length, drift, fmStatus: fmStatus ?? undefined }),
      fmStatus,
      session,
      hue: Number(str(r.fm.hue, '210')),
      desc: str(r.fm.desc),
      code,
      version: h.length,
      reason: h[0]?.reason || '',
      drift,
      driftFiles,
      // @@@ evidence - metadata links to A->B proof frames, read from the spec's frontmatter
      // (`evidence:` list). The backend is the source of truth here too — the dashboard never
      // fabricates these. Empty until the yatsu package records real captures and writes the links.
      evidence: list(r.fm.evidence),
      body: r.body.trim(),
      // @@@ three parts - raw source (human) / expanded spec (agent) / current state (agent), parsed
      // from labelled `## …` sections. null for legacy bodies that aren't authored in three parts.
      parts: parseParts(r.body),
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
