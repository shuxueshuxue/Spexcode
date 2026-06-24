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

// @@@ deriveStatus - a node's status is DERIVED, never hand-written. States, in precedence:
//   pending - DECLARED todo: a node whose frontmatter says `status: pending` AND has no implementing
//             code yet (empty/absent code:, no drift) is a written-but-unbuilt spec — it reads pending
//             REGARDLESS of how many spec.md commits it has, and even while a worktree is merely adding
//             its text (overlay). The arrival of governed code (a non-empty code: list, or drift) is
//             what graduates it: from then on it derives active/drift/merged like any coded node. This
//             check is FIRST so a todo isn't flipped to `active`/`merged` just by existing in git.
//   active  - an unmerged managed worktree has pending ops on this node (live, in-flight work).
//             Only buildBoard knows the overlay, so /api/specs (no overlay) never reports active.
//   drift   - governed code has moved ahead of the spec's latest version (drift > 0) — maybe stale.
//   merged  - has committed version(s) on main and is in sync.
//   pending (fallback) - no committed version yet (version 0), or a DECLARED status when git is
//             unreadable and every node would otherwise collapse to version 0 / pending.
export function deriveStatus(d: { version: number; drift: number; hasOverlay?: boolean; hasCode?: boolean; fmStatus?: string }): DerivedStatus {
  if (d.fmStatus === 'pending' && !d.hasCode && d.drift === 0) return 'pending'
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

// @@@ unique-by-construction ids - a node's id was basename(dir), so two folders sharing a leaf name anywhere
// in the tree (a `core` package vs the `.config/core` plugin) silently clobbered each other in the id-keyed
// board / wikilinks / CLI. Re-key every node to the SHORTEST trailing path-suffix that is globally unique: a
// node keeps its bare leaf name when that's unique (the common case — nothing changes), and only a real
// collision grows the id by minimal parent qualification (`gugu/core` vs `.config/core`). Parent links are
// recomputed by path-ancestry, so a basename collision can't leak into them either. The full path is always
// unique, so the suffix search always terminates. walk's basename id/parent are placeholders this overrides.
function reId(acc: Raw[]): void {
  const segs = acc.map((r) => r.relPath.split(/[/\\]/).slice(1, -1))   // path under .spec, minus 'spec.md'
  const suffix = (s: string[], k: number) => s.slice(s.length - k).join('/')
  for (let i = 0; i < acc.length; i++) {
    const s = segs[i]
    let k = 1
    while (k < s.length && segs.some((o, j) => j !== i && o.length >= k && suffix(o, k) === suffix(s, k))) k++
    acc[i].id = suffix(s, k)
  }
  for (let i = 0; i < acc.length; i++) {
    let best = -1
    for (let j = 0; j < acc.length; j++) {
      const o = segs[j], s = segs[i]
      if (j !== i && o.length < s.length && o.every((seg, x) => seg === s[x]) && (best < 0 || o.length > segs[best].length)) best = j
    }
    acc[i].parent = best >= 0 ? acc[best].id : null
  }
}

function raws(): Raw[] {
  const acc: Raw[] = []
  if (existsSync(SPEC_DIR)) walk(SPEC_DIR, null, acc)
  reId(acc)
  return acc
}

// @@@ specOwners - which spec node(s) GOVERN a file, by the same claim rule lint/yatsu use (exact path,
// directory prefix, or *-glob). LIGHT: reads only frontmatter `code:` via raws() — no git history, drift,
// or diff walk — so a per-edit PostToolUse hook can call it cheaply on every first-touch of a file. Takes
// an absolute OR repo-relative path; returns {id, desc} per claiming node. More than one = a shared hub
// file (the caller surfaces that as the "give this file a single owner" signal — see the governed/related
// split). Empty = uncovered.
export function specOwners(file: string): { id: string; desc: string }[] {
  const rel = file.startsWith('/') ? relative(ROOT, file) : file
  const claims = (cf: string): boolean => {
    if (cf === rel) return true
    if (rel.startsWith(cf.replace(/\/+$/, '') + '/')) return true
    if (cf.includes('*')) return new RegExp('^' + cf.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(rel)
    return false
  }
  return raws().filter((r) => list(r.fm.code).some(claims)).map((r) => ({ id: r.id, desc: str(r.fm.desc) }))
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
  // @@@ hub attribution - a file listed in `code:` by >=2 nodes is a HUB with no single owner; per-node
  // drift on it fans the SAME change across every co-owner (noise the agent learns to ignore — see
  // [[governed-related]]). Count governors once, then exclude hub files from a node's driftFiles: a hub
  // gets ONE `hub` lint warning + the live edit-time flag instead of N false drifts. Drift resumes the
  // moment a file has a single governor (the other claimants moved it to `related:`).
  const allRaws = raws()
  const governCount = new Map<string, number>()
  for (const rr of allRaws) for (const f of list(rr.fm.code)) governCount.set(f, (governCount.get(f) ?? 0) + 1)
  return Promise.all(allRaws.map(async (r) => {
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
      .filter((f) => (governCount.get(f) ?? 0) < 2)   // hub files (>=2 governors) drift nobody — see governCount
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
      status: deriveStatus({ version: h.length, drift, hasCode: code.length > 0, fmStatus: fmStatus ?? undefined }),
      fmStatus,
      session,
      hue: Number(str(r.fm.hue, '210')),
      desc: str(r.fm.desc),
      code,
      related: list(r.fm.related),   // files the node references but does NOT own — counted for coverage, never for drift/yatsu
      version: h.length,
      reason: h[0]?.reason || '',
      // @@@ lastEdited - ISO date of the node's latest version commit (h is newest-first), or null
      // when it has no committed version. The board's node row shows "last edited … ago" from this
      // when no live session is currently editing the node (see SpecNode's second row).
      lastEdited: h[0]?.date || null,
      drift,
      driftFiles,
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

// @@@ config presets - REFLEXIVE, SKILL-SHAPED preset nodes whose folder IS a skill bundle: `spec.md`'s
// body is the agent prompt/contract (with a {{targets}} placeholder the launcher fills with the
// @-referenced nodes), and the SAME folder may co-locate auxiliary files — scripts, assets — that the
// preset ships for the agent to run deterministically. So each preset reports its folder `dir`
// (repo-relative) and its `files` (co-located paths, spec.md excluded) alongside name/title/desc/kind/body.
// `kind` ∈ mutating|report tells the launcher whether the preset edits the graph or only reports on it.
export type ConfigPreset = { name: string; title: string; desc: string; kind: string; dir: string; files: string[]; body: string }
// @@@ field-driven surface - a config plugin is a FLAT direct child of a config root (`<root>/<name>/spec.md`)
// that carries a `surface: system|slash` frontmatter field naming where it plugs in. There are no `slash/` or
// `system/` bucket dirs (those were graph-invisible grouping dirs with no spec.md, so the spec graph skipped
// them — path != graph); the surface is a FIELD on the node, so the plugin is a real graph child of its root.
// BOTH config roots participate: `.config` (the instance — DIY dev-flow plugins) and `config` (the project
// system spec). loadConfig gathers the `slash` surface, loadSystemConfig the `system` surface; each scans the
// flat children under every root and filters by the field. The plugins also show on the board as ordinary
// spec nodes (via loadSpecs).
// @@@ root node - the spec tree's single top-level node: the one directory directly under .spec/ that
// holds a spec.md. The dogfood repo names it 'spexcode'; a repo scaffolded by `spex init` names it
// 'project' (or whatever the adopter renames it to). Detected DYNAMICALLY so the config loaders resolve
// the ACTUAL root's config dirs — never a hardcoded 'spexcode', which silently returned [] in an adopter
// repo, so their .config/core contract never loaded and their launched agents got no system prompt.
// Returns null when .spec holds no such directory. (resolveLayout's `main` is a checkout PATH, not the
// root node NAME, so it can't serve this — a tiny filesystem probe is the right seam.)
function rootNode(): string | null {
  if (!existsSync(SPEC_DIR)) return null
  for (const e of readdirSync(SPEC_DIR, { withFileTypes: true })) {
    if (e.isDirectory() && existsSync(join(SPEC_DIR, e.name, 'spec.md'))) return e.name
  }
  return null
}
// BOTH config roots under the detected root node: `.config` (the instance — DIY dev-flow plugins) and
// `config` (the project system spec). Resolved at call time (not module-eval) so it tracks the live tree.
function configRoots(): string[] {
  const root = rootNode()
  if (!root) return []
  return ['.config', 'config'].map((r) => join(SPEC_DIR, root, r))
}
// co-located bundle files = everything under the node folder except its spec.md, repo-relative, recursive.
function bundleFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name !== 'spec.md') out.push(relative(ROOT, p))
    }
  }
  walk(dir)
  return out.sort()
}
// gather the preset nodes that are flat children of a config root and declare `surface: <surface>`.
function loadSurface(surface: 'slash' | 'system'): ConfigPreset[] {
  const out: ConfigPreset[] = []
  for (const root of configRoots()) {
    if (!existsSync(root)) continue
    for (const e of readdirSync(root, { withFileTypes: true })) {
      const nodeDir = join(root, e.name)
      if (!e.isDirectory() || !existsSync(join(nodeDir, 'spec.md'))) continue
      const { fm, body } = parseFrontmatter(readFileSync(join(nodeDir, 'spec.md'), 'utf8'))
      // surface is a FIELD: only nodes declaring this surface gather; the rest (other surface, or none —
      // e.g. a doc node like `config/surface`) are skipped.
      if (str(fm.surface) !== surface) continue
      // @@@ skip pending - a `status: pending` plugin is DECLARED INTENT, not yet an active plugin. It still
      // renders on the board (via loadSpecs), but it must NOT gather: neither offered as a slash preset nor
      // folded into a system prompt. Only built/active plugins surface here, so pending stubs stay inert.
      if (str(fm.status) === 'pending') continue
      out.push({
        name: e.name,
        title: str(fm.title, e.name),
        desc: str(fm.desc),
        kind: str(fm.kind, 'mutating'),
        dir: relative(ROOT, nodeDir),
        files: bundleFiles(nodeDir),
        body: body.trim(),
      })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
// the slash presets (new-session `/` dropdown).
export function loadConfig(): ConfigPreset[] { return loadSurface('slash') }
// the system contracts (folded into a launched agent's --append-system-prompt).
export function loadSystemConfig(): ConfigPreset[] { return loadSurface('system') }
