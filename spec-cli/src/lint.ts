import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot, stagedFiles, git } from './git.js'
import { loadSpecs } from './specs.js'

export type Finding = { level: 'error' | 'warn'; rule: string; spec?: string; file?: string; msg: string }

export type LintConfig = {
  governedRoots: string[]       // dirs whose source files must each be governed by a spec (coverage). '.' = whole project (safe: only git-TRACKED files, so node_modules/build/nested worktrees never count).
  sourceExtensions: string[]    // extensions coverage treats as source files
  testGlobs: string[]           // globs EXCLUDED from coverage — tests aren't governed product (default ['**/*.test.*']; set [] to govern tests too)
  identifierExtensions: string[]// extensions the altitude bare-filename signal recognises (see IDENT below)
  altitude: { lineBudget: number; charBudget: number; sizeable: number; dense: number; steps: number }
  maxChildren: number        // breadth budget: warn at >= this many direct children
  driftErrorThreshold: number// commit-local gate HARD-BLOCKS a commit touching a node >= this many commits behind
  maxOwners: number          // warn when a file is governed (code:) by > this many nodes
  scenarioTags: string[]     // the closed vocabulary a yatsu scenario's `tags:` must draw from; extend it to mint a new tag
}
const DEFAULT_CONFIG: LintConfig = {
  governedRoots: ['spec-dashboard/src', 'spec-cli/src'],
  sourceExtensions: ['ts', 'tsx', 'js', 'jsx'],
  testGlobs: ['**/*.test.*'],
  identifierExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'md'],
  altitude: { lineBudget: 50, charBudget: 4200, sizeable: 35, dense: 1.3, steps: 3 },
  maxChildren: 8,
  driftErrorThreshold: 3,
  maxOwners: 3,
  scenarioTags: ['frontend-e2e', 'backend-api', 'cli', 'desktop', 'mobile'],
}
export function loadConfig(root: string): LintConfig {
  try {
    const raw = JSON.parse(readFileSync(join(root, 'spexcode.json'), 'utf8'))
    const c = raw?.lint ?? {}
    return { ...DEFAULT_CONFIG, ...c, altitude: { ...DEFAULT_CONFIG.altitude, ...(c.altitude ?? {}) } }
  } catch {
    return DEFAULT_CONFIG   // no file (or unreadable) → tuned defaults; lint is the same as before.
  }
}

// a minimal glob → RegExp anchored to the full repo-relative path: `**` = any dirs, `*` = within a segment.
function globToRe(glob: string): RegExp {
  const body = glob.split(/(\*\*\/|\*\*|\*|\?)/).map((seg) => {
    if (seg === '**/') return '(?:.*/)?'
    if (seg === '**') return '.*'
    if (seg === '*') return '[^/]*'
    if (seg === '?') return '[^/]'
    return seg.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }).join('')
  return new RegExp(`^${body}$`)
}

// coverage enumerates source via GIT-TRACKED files (`git ls-files`, through git() which strips the hook's
// GIT_DIR), NOT a raw fs walk. Tracked-only auto-excludes node_modules + build output (gitignored), nested
// or linked worktrees + submodules (a separate index), `.git`, and anything untracked — so governedRoots
// '.' means "all tracked source" with no fs explosion and no hand-maintained skip list (git IS the database).
// Test files drop per cfg.testGlobs (default *.test.*; set [] to govern tests too).
function trackedSourceFiles(root: string, roots: string[], src: RegExp, testGlobs: string[]): string[] {
  const testRes = testGlobs.map(globToRe)
  const out = new Set<string>()
  for (const r of roots) {
    let listed = ''
    try { listed = git(['-C', root, 'ls-files', '-z', '--', r]) } catch { continue }
    for (const f of listed.split('\0')) {
      if (!f || !src.test(f) || testRes.some((re) => re.test(f))) continue
      out.add(f)
    }
  }
  return [...out]
}

// code-identifier signals: camelCase | snake_case | foo( | `backticked` | /a/path.ext | bare file.ext. Only
// the bare-filename branch needs the extension allowlist (config, so a non-TS project recognises its own
// sources) — without it a bare `word.word` would match ordinary prose like "e.g".
function identRe(extensions: string[]): RegExp {
  const ext = extensions.join('|')
  return new RegExp(`[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*|\\b[a-z]+_[a-z0-9_]+\\b|\\b\\w+\\(|\`[^\`]+\`|\\/[\\w./-]+\\.\\w+|\\b[\\w-]+\\.(${ext})\\b`, 'g')
}
// step-by-step how-to phrasing: numbered steps, or sequencing connectives that walk through mechanics.
const STEP_LINE = /^\s*(\d+[.)]\s|[-*]\s*(first|then|next|finally)\b)|(^|[,;]\s*)(first|then|next|finally),/i
// returns a one-line reason naming whichever low-altitude proxy(ies) tripped (length / identifier density /
// step-by-step), or null when the body is at altitude.
function altitude(body: string, cfg: LintConfig, ident: RegExp): string | null {
  const a = cfg.altitude
  const lines = body.split('\n')
  const nb = lines.filter((l) => l.trim()).length
  const chars = body.length
  // identifiers and step phrasing are read from PROSE only — a fenced code sample is acknowledged code,
  // not low-altitude narration, so it inflates length but not density.
  let inFence = false, signals = 0, steps = 0
  for (const l of lines) {
    if (/^\s*```/.test(l)) { inFence = !inFence; continue }
    if (inFence || !l.trim()) continue
    signals += l.match(ident)?.length ?? 0
    if (STEP_LINE.test(l)) steps++
  }
  const density = signals / Math.max(1, nb)
  const why: string[] = []
  if (nb > a.lineBudget || chars > a.charBudget) why.push(`${nb} non-blank lines / ${chars} chars over budget (${a.lineBudget}/${a.charBudget})`)
  if (nb > a.sizeable && density > a.dense) why.push(`code-identifier density ${density.toFixed(2)}/line over ${a.dense}`)
  if (nb > a.sizeable && steps >= a.steps) why.push(`${steps} step-by-step how-to lines`)
  return why.length ? why.join('; ') : null
}

export async function specLint(): Promise<Finding[]> {
  const root = repoRoot()
  const cfg = loadConfig(root)
  const ident = identRe(cfg.identifierExtensions)
  const srcRe = new RegExp(`\\.(${cfg.sourceExtensions.join('|')})$`)
  const specs = await loadSpecs()
  const out: Finding[] = []

  // integrity + build the file -> owners map.
  const owners = new Map<string, string[]>()
  for (const s of specs) {
    for (const f of s.code) {
      if (!existsSync(join(root, f)))
        out.push({ level: 'error', rule: 'integrity', spec: s.id, file: f, msg: `spec '${s.id}' lists a missing file: ${f}` })
      owners.set(f, [...(owners.get(f) ?? []), s.id])
    }
  }
  // a file is COVERED if any node GOVERNS (code:) or merely REFERENCES (related:) it; integrity covers both.
  // `related:` is the coverage net: govern is a sharp ideally-one-file pointer, so most files are reached by
  // related, not govern (see [[governed-related]]). It carries coverage but never drift/yatsu.
  const claimed = new Set<string>(owners.keys())
  for (const s of specs) for (const f of s.related) {
    if (!existsSync(join(root, f)))
      out.push({ level: 'error', rule: 'integrity', spec: s.id, file: f, msg: `spec '${s.id}' lists a missing related file: ${f}` })
    claimed.add(f)
  }

  // living: a spec body describes the node's CURRENT intent — it is not a changelog. Version history
  // (every content commit, its reason/session/line-diff) is read from git and shown in the dashboard's
  // recent/history tabs, so a `## vN`-style heading in the body is duplicated, drift-prone state.
  // Reject it. Fence-aware — a `## v2` inside a ``` block is sample text, not a heading.
  const VER_HEADING = /^#{1,6}\s+v\d+\b/
  for (const s of specs) {
    let inFence = false
    for (const line of s.body.split('\n')) {
      if (/^\s*```/.test(line)) { inFence = !inFence; continue }
      if (!inFence && VER_HEADING.test(line))
        out.push({ level: 'error', rule: 'living', spec: s.id, msg: `'${s.id}' has a changelog heading "${line.trim()}" — keep the body current-state; version history lives in git (recent/history tabs)` })
    }
  }

  // altitude: a body that re-narrates mechanics instead of stating contract/intent (WARN — soft budget).
  for (const s of specs) {
    const why = altitude(s.body, cfg, ident)
    if (why) out.push({ level: 'warn', rule: 'altitude', spec: s.id, msg: `'${s.id}' body reads low-altitude (mechanics, not contract): ${why}` })
  }

  // breadth: a node with too many DIRECT children is altitude's structural twin — splitting a node to pass
  // altitude shouldn't just relocate the sprawl into a wide flat fan-out (WARN — soft, advisory). Children
  // are derived from the parent links loadSpecs already computes; no explicit child array to keep in sync.
  const childCount = new Map<string, number>()
  for (const s of specs) if (s.parent) childCount.set(s.parent, (childCount.get(s.parent) ?? 0) + 1)
  for (const s of specs) {
    const n = childCount.get(s.id) ?? 0
    if (n >= cfg.maxChildren)
      out.push({ level: 'warn', rule: 'breadth', spec: s.id, msg: `'${s.id}' has ${n} direct child nodes (>= ${cfg.maxChildren}) — is an intermediate grouping layer missing? (a flat list of genuine peers is sometimes right — ignore if so)` })
  }

  // coverage: every governed source file must be claimed by at least one spec.
  const governed = trackedSourceFiles(root, cfg.governedRoots, srcRe, cfg.testGlobs)
  // no governed source found at all → the defaults name this repo's own dirs, so an adopter who never set
  // lint.governedRoots would otherwise see a falsely-clean board. Make it loud and point at the knob.
  if (governed.length === 0)
    out.push({ level: 'warn', rule: 'coverage', msg: `governing NOTHING — no source files under governedRoots [${cfg.governedRoots.join(', ')}]. Set lint.governedRoots in spexcode.json to your project's source dirs.` })
  for (const f of governed)
    if (!claimed.has(f)) out.push({ level: 'warn', rule: 'coverage', file: f, msg: `no spec governs: ${f}` })

  // too-many-owners: many nodes governing one file is ordinary composition (drift fans to each — correct,
  // every owner has a stake), so this is NOT flagged. Only an OVER-owned file is a smell — governed by more
  // than maxOwners nodes, it has accreted more independently-specified functionality than one file should
  // hold (see [[governed-related]]). ONE summary line (not one per file — its own wall of noise): the count,
  // the worst offenders, and the remedy, which blames the FILE not the ownership — SPLIT it so each governor
  // reclaims its own module; or merge the nodes if they're one concern; or give it a single foundation owner.
  const over = [...owners].filter(([, ids]) => ids.length > cfg.maxOwners).sort((a, b) => b[1].length - a[1].length)
  if (over.length) {
    const top = over.slice(0, 5).map(([f, ids]) => `${f.split('/').pop()}(${ids.length})`).join(', ')
    out.push({ level: 'warn', rule: 'owners', msg: `${over.length} file(s) are governed by > ${cfg.maxOwners} nodes — each holds more separately-specified functionality than one file should. Worst: ${top}. SPLIT the file so each governor owns its own module (or merge the nodes, or give it a single foundation owner + related:).` })
  }

  // drift: a governed file has commits NOT yet reflected in its spec. Rigorous by git ancestry —
  // loadSpecs computes `driftFiles` via `git rev-list <spec's last version>..HEAD -- <file>` (see
  // commitsSince in git.ts), so each warning is "N commit(s) ahead", not a timestamp guess.
  for (const s of specs) {
    for (const d of s.driftFiles)
      out.push({ level: 'warn', rule: 'drift', spec: s.id, file: d.file, msg: `${d.file} is ${d.behind} commit(s) ahead of spec '${s.id}' (v${s.version}) — may be stale` })
  }

  return out
}

export const DRIFT_GUIDANCE = `DRIFT — a governed file has moved ahead of its spec. A CHECKPOINT, not a chore: find WHERE the truth
broke along  raw intent → expanded spec → code: link → code structure → implementation, fix THAT layer.

  Inspect:  spex lint                                                       which files, against which spec
            the node's spec.md                                             its raw source + expanded spec
            git diff $(git log -1 --format=%H -- <spec.md>)..HEAD -- <file>   the code delta since the spec

Diagnose, then apply the one honest remedy:
  • contract changed        → rewrite the spec body to the new intent, commit it (re-versions the node)
  • only mechanics changed  → spex ack <node>   "checked — spec still valid"   (give a real reason)
  • implementation is WRONG → the spec is right; fix the CODE back toward it, then ack
  • wrong code: link        → the node shouldn't own this file (or owns it too broadly); fix frontmatter
  • expanded spec ≠ raw     → the spec drifted from human intent; fix the expanded spec to serve the raw
  • structural mismatch     → one file owned by many specs / a feature with no home: refactor so a file
                              maps to a node, or file an issue and link it (defer honestly)

Never patch. A reasoned ack or a real fix are recorded and re-judged at review; a blind ack is a lie.`

// commit-local: an empty staged index (CI, audit) → no blockers, drift stays advisory; non-empty → block
// only when an OWN staged file belongs to a node already >= driftErrorThreshold behind. Sub-threshold drift
// on a touched node is returned for an advisory nudge; the backlog on untouched nodes never blocks.
export async function driftGate(): Promise<{ blocked: string[]; touched: { id: string; drift: number }[]; threshold: number }> {
  const root = repoRoot()
  const cfg = loadConfig(root)
  const staged = stagedFiles(root)
  if (!staged.length) return { blocked: [], touched: [], threshold: cfg.driftErrorThreshold }
  const specs = await loadSpecs()
  const owners = new Map<string, string[]>()
  for (const s of specs) for (const f of s.code) owners.set(f, [...(owners.get(f) ?? []), s.id])
  const byId = new Map(specs.map((s) => [s.id, s]))
  const ids = new Set<string>()
  for (const f of staged) for (const o of owners.get(f) ?? []) ids.add(o)
  const touched = [...ids].map((id) => byId.get(id)!).filter((s) => s && s.drift > 0)
    .map((s) => ({ id: s.id, drift: s.drift })).sort((a, b) => b.drift - a.drift)
  return { blocked: touched.filter((t) => t.drift >= cfg.driftErrorThreshold).map((t) => t.id), touched, threshold: cfg.driftErrorThreshold }
}
