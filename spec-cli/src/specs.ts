import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, basename } from 'node:path'
import { repoRoot, historyIndex, rowsFor, statsFor, pathsStats, driftIndex, driftFor, fileDiffAt } from './git.js'

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

// @@@ two-part body - a spec body may be authored as two clearly-labelled parts, each with a
// different owner and change-cadence:
//   raw source    (human) — the short, rarely-changed human intent/decisions; editing it needs human
//                            approval. This is the ground truth the expanded spec must satisfy.
//   expanded spec (agent) — the detailed BEHAVIORAL understanding (not implementation); versioned
//                            often, but must always still match the raw source.
// There is deliberately NO agent-authored "current state" part: a node's what's-done is DERIVED, never
// narrated — agents hallucinate completion. The derived 4-state status + version + drift (see
// deriveStatus) carry "what's done" instead. Detected by `## raw source` / `## expanded spec` level-2
// headings. A body WITHOUT these headings parses to null — the dashboard then renders the whole body as
// before (back-compat). These are STRUCTURE headings, not `## vN` changelog headings, so `spex lint`'s
// living rule is happy.
export type SpecParts = {
  rawSource: string
  expandedSpec: string
}
const PART_ALIASES: Record<string, 'rawSource' | 'expandedSpec'> = {
  'raw source': 'rawSource',
  'expanded spec': 'expandedSpec',
}
function parseParts(body: string): SpecParts | null {
  const acc = { rawSource: [] as string[], expandedSpec: [] as string[] }
  let cur: 'rawSource' | 'expandedSpec' | null = null
  let inFence = false
  let any = false
  for (const line of body.split('\n')) {
    const fence = /^\s*```/.test(line)
    if (!inFence && !fence) {
      const h2 = line.match(/^##\s+(.+?)\s*$/)   // exactly two hashes — `###` won't match
      if (h2) {
        const key = PART_ALIASES[h2[1].trim().toLowerCase()]
        if (key) { cur = key; any = true; continue }
        // an unrecognized `## …` heading is just content of the current part — fall through.
      }
    }
    if (fence) inFence = !inFence
    if (cur === 'rawSource') acc.rawSource.push(line)
    else if (cur === 'expandedSpec') acc.expandedSpec.push(line)
  }
  if (!any) return null
  const t = (a: string[]) => a.join('\n').trim()
  return { rawSource: t(acc.rawSource), expandedSpec: t(acc.expandedSpec) }
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

// @@@ diff cache - a commit's patch is immutable, so memo fileDiffAt by (version sha + spec.md path).
// loadSpecs precomputes every node's latest line-diff for the board (so the latest history item is
// instant — no per-open fetch + git call), and specDiffAt serves any version's diff on demand over the
// SAME cache. A warm entry makes both a Map lookup; only a sha not seen before pays a single git show.
// `{hash:'',patch:''}` for an unversioned node — no git call, and the history item renders the honest
// "no recorded change" instantly. Keyed by path too because one commit can patch several nodes' spec.md.
const diffCache = new Map<string, { hash: string; patch: string }>()
async function latestDiff(relPath: string, hash: string): Promise<{ hash: string; patch: string }> {
  if (!hash) return { hash: '', patch: '' }
  const key = `${hash}\0${relPath}`
  const hit = diffCache.get(key)
  if (hit) return hit
  const val = { hash, patch: await fileDiffAt(ROOT, relPath, hash) }
  diffCache.set(key, val)
  return val
}

export async function loadSpecs() {
  // both indexes are one cached git walk each and independent — fetch them in parallel (async git, so
  // they don't block the server's event loop or pay sync fork() cost). Every node below is a pure lookup
  // EXCEPT its precomputed latest diff, which is one cached git show that only re-runs on a new version.
  const [idx, didx] = await Promise.all([historyIndex(ROOT), driftIndex(ROOT)])
  return Promise.all(raws().map(async (r) => {
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
      // @@@ lastEdited - ISO date of the node's latest version commit (h is newest-first), or null
      // when it has no committed version. The board's node row shows "last edited … ago" from this
      // when no live session is currently editing the node (see SpecNode's second row).
      lastEdited: h[0]?.date || null,
      drift,
      driftFiles,
      // @@@ evidence - metadata links to A->B proof frames, read from the spec's frontmatter
      // (`evidence:` list). The backend is the source of truth here too — the dashboard never
      // fabricates these. Empty until the yatsu package records real captures and writes the links.
      evidence: list(r.fm.evidence),
      // @@@ lastDiff - the node's latest version's unified patch to its spec.md, PRECOMPUTED and shipped
      // with the board (and /api/specs) so the history tab's expanded-by-default latest item renders its
      // line-diff instantly, with no round-trip (older items fetch theirs via /api/specs/:id/diff/:hash).
      // Cached by the version's commit sha (see latestDiff).
      lastDiff: await latestDiff(r.relPath, S),
      body: r.body.trim(),
      // @@@ two parts - raw source (human) / expanded spec (agent), parsed from labelled `## …`
      // sections. No agent-authored current-state part — what's-done is DERIVED (status/version/drift),
      // never narrated. null for legacy bodies that aren't authored in two parts.
      parts: parseParts(r.body),
    }
  }))
}

// @@@ specHistory - per-node version timeline, each row's line-diff SCOPED to this node: its spec.md
// (rename-followed via the bulk index's statsFor) PLUS the code it governs. Both stat sources are now
// gathered in ONE git walk EACH (statsFor is a lookup into the cached HEAD index; pathsStats is one
// `git log -- <code>` for the whole node), then summed per version. The old path ran `git show` once
// PER version — N synchronous subprocesses, which the long-running server spawns progressively slower,
// so a 10-version node's /history took >1s. The two sources stay separate because spec.md needs the
// index's rename-following that a plain `git log -- <path>` can't do.
export async function specHistory(id: string) {
  const node = raws().find((r) => r.id === id)
  if (!node) return []
  const codePaths = list(node.fm.code)
  // index (cached) and the code-path walk are independent — run them in parallel, both async git.
  const [idx, cStats] = await Promise.all([historyIndex(ROOT), pathsStats(ROOT, codePaths)])
  const sStats = statsFor(idx, node.relPath)
  return rowsFor(idx, node.relPath).map((v) => {
    const s = sStats.get(v.hash) ?? { additions: 0, deletions: 0, files: 0 }
    const c = cStats.get(v.hash) ?? { additions: 0, deletions: 0, files: 0 }
    return { ...v, additions: s.additions + c.additions, deletions: s.deletions + c.deletions, files: s.files + c.files }
  })
}

// @@@ specDiffAt - the unified line-diff one specific version introduced to a node's spec.md, by commit
// hash. The history tab fetches it lazily when an OLDER version's item expands (the latest version's diff
// already ships with the board as node.lastDiff, so it never needs this). Uses the SAME sha-keyed cache
// loadSpecs precomputes into, so a hash already seen as some node's lastDiff is an instant map hit, and
// fileDiffAt resolves the spec.md path AT that commit so a since-reparented node still shows the right
// patch. `{ hash:'', patch:'' }` for an empty hash; null for an unknown id.
export async function specDiffAt(id: string, hash: string) {
  const node = raws().find((r) => r.id === id)
  if (!node) return null
  if (!hash) return { hash: '', patch: '' }
  return latestDiff(node.relPath, hash)
}
