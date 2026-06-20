import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from './git.js'
import { loadSpecs } from './specs.js'

// @@@ spec-lint - keeps the spec<->code GRAPH honest (the judge keeps the CONTENT honest, elsewhere):
//   integrity (error): every file a spec lists in `code:` actually exists.
//   living    (error): a spec body is a CURRENT-STATE document, never a changelog — no `## vN`
//                      version headings. Version history is read from git (recent/history tabs).
//   coverage  (warn) : every governed source file is claimed by >=1 spec — no orphan code.
//   drift     (warn) : a governed file has commits newer than its spec's latest version -> maybe stale.
//   altitude  (warn) : a body has slid BELOW contract altitude into a mechanics dump (too long, and/or
//                      too dense with code identifiers, and/or step-by-step how-to) — see altitude().
// No file hashes are stored anywhere: git already is the hash database, so drift is derived live.

export type Finding = { level: 'error' | 'warn'; rule: string; spec?: string; file?: string; msg: string }

// the roots whose source files must each be governed by a spec. Could move to spexcode.json later.
const GOVERNED_ROOTS = ['spec-dashboard/src', 'spec-cli/src']
const SRC = /\.(ts|tsx|js|jsx)$/
const SKIP_DIRS = new Set(['node_modules', 'dist', '.vite'])

function sourceFiles(root: string, rel: string, acc: string[]) {
  const abs = join(root, rel)
  if (!existsSync(abs)) return
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) sourceFiles(root, join(rel, e.name), acc) }
    else if (SRC.test(e.name)) acc.push(join(rel, e.name))
  }
}

// @@@ altitude - a spec body should state CONTRACT and INTENT, not re-narrate the implementation. A body
// that has slid below that altitude reads like a how-to dump: it grows long, it thickens with code
// identifiers (camelCase, snake_case, `backticked` symbols, foo( calls, file/paths), and it slips into
// step-by-step phrasing. We can't judge meaning deterministically, but these are cheap, honest PROXIES.
// Thresholds are tuned against today's tree: the concise specs top out at ~41 non-blank lines / ~3.6k
// chars; genuine mechanics dumps start well above. Soft budgets, so it's a WARN — lint stays 0 errors.
// Returns a one-line reason naming whichever proxy(ies) tripped, or null when the body is at altitude.
const LINE_BUDGET = 50      // non-blank body lines before the body is "too long"
const CHAR_BUDGET = 4200    // body chars before "too long"
const SIZEABLE = 35         // density / step phrasing only count once the body is also this long…
const DENSE = 1.3           // …and identifier signals per non-blank line exceed this
const STEPS = 3             // …or it has this many step-by-step how-to lines
// code-identifier signals: camelCase | snake_case | foo( call | `backticked` | /a/path.ext | bare file.ext
const IDENT = /[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*|\b[a-z]+_[a-z0-9_]+\b|\b\w+\(|`[^`]+`|\/[\w./-]+\.\w+|\b[\w-]+\.(ts|tsx|js|jsx|json|md)\b/g
// step-by-step how-to phrasing: numbered steps, or sequencing connectives that walk through mechanics.
const STEP_LINE = /^\s*(\d+[.)]\s|[-*]\s*(first|then|next|finally)\b)|(^|[,;]\s*)(first|then|next|finally),/i
function altitude(body: string): string | null {
  const lines = body.split('\n')
  const nb = lines.filter((l) => l.trim()).length
  const chars = body.length
  // identifiers and step phrasing are read from PROSE only — a fenced code sample is acknowledged code,
  // not low-altitude narration, so it inflates length but not density.
  let inFence = false, signals = 0, steps = 0
  for (const l of lines) {
    if (/^\s*```/.test(l)) { inFence = !inFence; continue }
    if (inFence || !l.trim()) continue
    signals += l.match(IDENT)?.length ?? 0
    if (STEP_LINE.test(l)) steps++
  }
  const density = signals / Math.max(1, nb)
  const why: string[] = []
  if (nb > LINE_BUDGET || chars > CHAR_BUDGET) why.push(`${nb} non-blank lines / ${chars} chars over budget (${LINE_BUDGET}/${CHAR_BUDGET})`)
  if (nb > SIZEABLE && density > DENSE) why.push(`code-identifier density ${density.toFixed(2)}/line over ${DENSE}`)
  if (nb > SIZEABLE && steps >= STEPS) why.push(`${steps} step-by-step how-to lines`)
  return why.length ? why.join('; ') : null
}

export async function specLint(): Promise<Finding[]> {
  const root = repoRoot()
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
    const why = altitude(s.body)
    if (why) out.push({ level: 'warn', rule: 'altitude', spec: s.id, msg: `'${s.id}' body reads low-altitude (mechanics, not contract): ${why}` })
  }

  // coverage: every governed source file must be claimed by at least one spec.
  const governed: string[] = []
  for (const r of GOVERNED_ROOTS) sourceFiles(root, r, governed)
  for (const f of governed)
    if (!owners.has(f)) out.push({ level: 'warn', rule: 'coverage', file: f, msg: `no spec governs: ${f}` })

  // drift: a governed file has commits NOT yet reflected in its spec. Rigorous by git ancestry —
  // loadSpecs computes `driftFiles` via `git rev-list <spec's last version>..HEAD -- <file>` (see
  // commitsSince in git.ts), so each warning is "N commit(s) ahead", not a timestamp guess.
  for (const s of specs) {
    for (const d of s.driftFiles)
      out.push({ level: 'warn', rule: 'drift', spec: s.id, file: d.file, msg: `${d.file} is ${d.behind} commit(s) ahead of spec '${s.id}' (v${s.version}) — may be stale` })
  }

  return out
}
