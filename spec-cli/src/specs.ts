import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, basename } from 'node:path'
import { repoRoot, historyIndex, rowsFor, statsFor, pathsStats, driftIndex, driftFor, fileDiffAt } from './git.js'

// a node is any directory under .spec holding a spec.md; its parent is the nearest ancestor that also holds one.
const ROOT = repoRoot()
const SPEC_DIR = join(ROOT, '.spec')

type FmValue = string | string[]
type Raw = { id: string; parent: string | null; relPath: string; fm: Record<string, FmValue>; body: string }

// line-based frontmatter: scalars are `key: value`; an empty key followed by `- item` lines is a list (e.g. `code:`).
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

// re-key each node to the shortest globally-unique trailing path-suffix (overrides walk's placeholder
// basename id/parent); the second loop recomputes parent by path-ancestry.
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

// spec node(s) that GOVERN a file by the claim rule (exact path, dir-prefix, or *-glob); reads only
// frontmatter `code:` (cheap, no git) so a per-edit hook can call it. See [[governed-related]].
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

// memo fileDiffAt by (version sha + spec.md path) — a commit's patch is immutable. Keyed by path too: one
// commit can patch several nodes' spec.md. `{hash:'',patch:''}` for an unversioned node (no git call).
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

// filesystem-only slice of a node (id/title/path/desc/body, no git) for hot lexical reads like
// [[spec-search]]; same fields loadSpecs reports, without the git history/drift walk.
export type SpecLite = { id: string; title: string; path: string; desc: string; body: string }
export function loadSpecsLite(): SpecLite[] {
  return raws().map((r) => ({
    id: r.id,
    title: str(r.fm.title, r.id),
    path: r.relPath,
    desc: str(r.fm.desc),
    body: r.body.trim(),
  }))
}

export async function loadSpecs() {
  // both indexes are one cached git walk each and independent — fetch them in parallel (async git, off
  // the event loop). Every node below is then a pure lookup.
  const [idx, didx] = await Promise.all([historyIndex(ROOT), driftIndex(ROOT)])
  const allRaws = raws()
  return Promise.all(allRaws.map(async (r) => {
    const h = rowsFor(idx, r.relPath)
    // session = the Session: trailer of the node's latest version; frontmatter `session:` is the fallback.
    const fmSession = str(r.fm.session)
    const session = h[0]?.session || (fmSession && fmSession !== 'null' ? fmSession : null)
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
      status: deriveStatus({ version: h.length, drift, hasCode: code.length > 0, fmStatus: fmStatus ?? undefined }),
      fmStatus,
      session,
      hue: Number(str(r.fm.hue, '210')),
      desc: str(r.fm.desc),
      code,
      related: list(r.fm.related),
      version: h.length,
      reason: h[0]?.reason || '',
      // ISO date of the node's latest version commit (h is newest-first), or null if unversioned.
      lastEdited: h[0]?.date || null,
      drift,
      driftFiles,
      // the latest version's spec.md patch is NOT precomputed here (it cost 2 git show forks per node on
      // cold load); the history tab fetches it lazily via specDiffAt. See [[work-pane]].
      body: r.body.trim(),
      parts: parseParts(r.body),
    }
  }))
}

// per-node version timeline; each row sums the node's spec.md stat (rename-followed, via statsFor) and its
// governed-code stat (pathsStats) — separate because spec.md needs rename-following a plain `git log -- path` can't do.
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

// the line-diff a specific version introduced to a node's spec.md, by hash; fetched lazily when a history
// item expands. fileDiffAt resolves the spec.md path AT that commit (reparents). `{hash:'',patch:''}` for
// an empty hash, null for an unknown id.
export async function specDiffAt(id: string, hash: string) {
  const node = raws().find((r) => r.id === id)
  if (!node) return null
  if (!hash) return { hash: '', patch: '' }
  return latestDiff(node.relPath, hash)
}

// config presets - REFLEXIVE, SKILL-SHAPED preset nodes whose folder IS a skill bundle: `spec.md`'s
// body is the agent prompt/contract (with a {{targets}} placeholder the launcher fills with the
// @-referenced nodes), and the SAME folder may co-locate auxiliary files — scripts, assets — that the
// preset ships for the agent to run deterministically. So each preset reports its folder `dir`
// (repo-relative) and its `files` (co-located paths, spec.md excluded) alongside name/title/desc/kind/body.
// `kind` ∈ mutating|report tells the launcher whether the preset edits the graph or only reports on it.
// `events`/`order`/`block` are populated only for the `hook` surface (empty/0/false otherwise): which
// harness lifecycle events the node binds, its deterministic intra-event order, and whether it intends to
// block (honored only on block-capable events). See loadHookConfig + the hook compiler/dispatcher.
export type ConfigPreset = { name: string; title: string; desc: string; kind: string; dir: string; files: string[]; body: string; events: string[]; order: number; block: boolean }
// field-driven surface - a config plugin is a FLAT direct child of a config root (`<root>/<name>/spec.md`)
// that carries a `surface: system|command|hook|skill` frontmatter field naming where it plugs in. There are no
// `command/`/`system/`/`hook/`/`skill/` bucket dirs (those were graph-invisible grouping dirs with no spec.md, so
// the spec graph skipped them — path != graph); the surface is a FIELD on the node, so the plugin is a real
// graph child of its root. BOTH config roots participate: `.config` (the instance — DIY dev-flow plugins) and
// `config` (the project system spec). loadConfig gathers the `command` surface, loadSystemConfig the `system`
// surface, loadHookConfig the `hook` surface, loadSkillConfig the `skill` surface; each scans the children under
// every root and filters by the field. The plugins also show on the board as ordinary spec nodes (via loadSpecs).
// root node - the spec tree's single top-level node: the one directory directly under .spec/ that
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
// resolved at call time (not module-eval) so it tracks the live tree.
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
// gather the preset nodes under a config root that declare `surface: <surface>`. The scan is RECURSIVE —
// `surface` is a FIELD, not a path (the design's core tenet), so a plugin may live at ANY depth and a
// grouping parent may itself be a plugin (e.g. `.config/core` is a `surface: system` contract whose CHILDREN
// are `surface: hook` nodes). The field filter keeps it safe: a node only gathers if it declares THIS
// surface, so descending past a matched node never double-counts (children carry a different surface). For
// `system`/`command` the result is identical to the old one-level scan on the current tree — every existing
// such node is a flat direct child and no nested node declares those surfaces — so the gather set (hence
// the appended system prompt and the command dropdown) is byte-for-byte unchanged.
function loadSurface(surface: 'command' | 'system' | 'hook' | 'skill'): ConfigPreset[] {
  const out: ConfigPreset[] = []
  const visit = (nodeDir: string, name: string) => {
    if (existsSync(join(nodeDir, 'spec.md'))) {
      const { fm, body } = parseFrontmatter(readFileSync(join(nodeDir, 'spec.md'), 'utf8'))
      // @@@ skip pending - a `status: pending` plugin is DECLARED INTENT, not yet active. It renders on the
      // board (via loadSpecs) but must NOT gather: neither a command preset, nor folded into a system prompt,
      // nor a live hook. Only built/active plugins surface here, so pending stubs stay inert.
      if (str(fm.surface) === surface && str(fm.status) !== 'pending') {
        out.push({
          name,
          title: str(fm.title, name),
          desc: str(fm.desc),
          kind: str(fm.kind, 'mutating'),
          dir: relative(ROOT, nodeDir),
          files: bundleFiles(nodeDir),
          body: body.trim(),
          events: list(fm.events),
          order: Number(str(fm.order, '0')) || 0,
          block: str(fm.block) === 'true',
        })
      }
    }
    for (const e of readdirSync(nodeDir, { withFileTypes: true })) {
      if (e.isDirectory()) visit(join(nodeDir, e.name), e.name)
    }
  }
  for (const root of configRoots()) {
    if (!existsSync(root)) continue
    for (const e of readdirSync(root, { withFileTypes: true })) {
      if (e.isDirectory()) visit(join(root, e.name), e.name)
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
export function loadConfig(): ConfigPreset[] { return loadSurface('command') }
export function loadSystemConfig(): ConfigPreset[] { return loadSurface('system') }
// the hook handlers (compiled into the per-session hook manifest the dispatcher reads). Each carries its
// `events`/`order`/`block` binding + co-located script `files`.
export function loadHookConfig(): ConfigPreset[] { return loadSurface('hook') }
// the skill bundles (rendered into each harness's auto-discovered SKILL.md dir). Each node's `desc` is the
// load-trigger and its `body` is the on-demand instructions; loadSurface passes the folder basename as `name`.
export function loadSkillConfig(): ConfigPreset[] { return loadSurface('skill') }
