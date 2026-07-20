import { join } from 'node:path'
import { createRequire } from 'node:module'
import { gitA, type DriftIndex, ancestorsOf, inAncestors, ackCoverFor } from './git.js'

// ---- the anchor vocabulary ([[code-anchor]]) ----
// A spec's `code:` entry may pin ONE named unit: `path#symbol` (`#Class.method` for a class method).
// Everything below the entry parse splits into two layers:
//   - the LANGUAGE SEAM: pure extractors (content, filename) -> Unit[] — no git, no cache, no fs.
//     Each extension maps to exactly ONE designated extractor; there is NO cross-tier fallback.
//   - the LANGUAGE-AGNOSTIC ENGINE: blob-oid memo, anchor resolution (dead/ambiguous), diff-hunk ∩
//     unit-range intersection over the drift window. It never knows which language it is measuring.

export type Unit = { name: string; kind: string; start: number; end: number; typeOnly?: boolean }

export type Extractor = {
  id: string
  claims(ext: string): boolean
  // true = usable here. A string is WHY it cannot run — lint turns that into an ERROR with the repair
  // entrypoint (never a silent or degraded pass): the designated extractor either runs or the anchor
  // is unverifiable.
  ready(): true | string
  // PURE function of its arguments (importable by an external benchmark/scorer as-is). Throws when the
  // content cannot be parsed — the caller maps that to a conservative verdict, never a silent skip.
  extract(content: string, filename: string): Unit[]
}

export type CodeEntry = { path: string; anchor: string | null }
export function parseCodeEntry(raw: string): CodeEntry {
  const i = raw.indexOf('#')
  if (i < 0) return { path: raw.trim(), anchor: null }
  return { path: raw.slice(0, i).trim(), anchor: raw.slice(i + 1).trim() || null }
}

// ---- relation parsing: ONE structured path+selector grammar for code: AND related: ----
// A relation's raw rows group per base path: a row is bare (`path`, whole-file — today's semantics,
// unchanged) or scoped (`path#symbol`), and any number of scoped rows on the SAME base file fold into
// one entry whose selectors are OR'd (a commit hitting any counts once; no selector-count cap — the
// benchmark roster's 1–3 was an annotation rubric, never product syntax). STRUCTURAL verdicts live
// here, pure and loud: an exact duplicate row, mixing bare with selectors on one base path, and a
// selector on a glob are all `problems` the caller turns into integrity errors. Filesystem/git
// verdicts (existence, directories, dead/ambiguous units, extractor readiness) stay the caller's —
// this parser never touches fs.
export type RelationEntry = { path: string; selectors: string[] }
export type RelationParse = { entries: RelationEntry[]; problems: string[] }
export function parseRelation(raws: string[], relation: 'code' | 'related'): RelationParse {
  const order: string[] = []
  const byPath = new Map<string, { bare: boolean; selectors: string[] }>()
  const problems: string[] = []
  for (const raw of raws) {
    const { path, anchor } = parseCodeEntry(raw)
    let e = byPath.get(path)
    if (!e) { e = { bare: false, selectors: [] }; byPath.set(path, e); order.push(path) }
    if (anchor === null) {
      if (e.bare) problems.push(`${relation}: lists '${path}' twice — drop the duplicate entry`)
      e.bare = true
    } else if (e.selectors.includes(anchor)) {
      problems.push(`${relation}: lists selector '${path}#${anchor}' twice — drop the duplicate`)
    } else e.selectors.push(anchor)
  }
  for (const path of order) {
    const e = byPath.get(path)!
    if (e.bare && e.selectors.length)
      problems.push(`${relation}: mixes bare '${path}' with '${path}#…' selectors — one base path is either whole-file or selector-scoped, never both; drop one form`)
    if (e.selectors.length && path.includes('*'))
      problems.push(`${relation}: '${path}#${e.selectors[0]}' puts a selector on a glob — a selector scopes ONE real file`)
  }
  return { entries: order.map((p) => ({ path: p, selectors: byPath.get(p)!.selectors })), problems }
}

// ---- extractor: ts-ast (the designated extractor for the JS family) ----
// Parse-only via the HOST project's own typescript (resolved from the repo root, walking up like any
// require) — never a bundled copy, so the parse matches what the project itself compiles with. Not
// resolvable => ready() returns the repair entrypoint and lint ERRORS (no regex fallback for JS).
const JS_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'])

export function tsAstExtractor(root: string): Extractor {
  let ts: any | null | undefined // undefined = unprobed; null = unresolvable
  let readiness: true | string | undefined
  const probe = () => {
    if (ts !== undefined) return
    try { ts = createRequire(join(root, 'package.json'))('typescript') } catch { ts = null }
  }
  return {
    id: 'ts-ast',
    claims: (ext) => JS_EXTS.has(ext),
    ready() {
      if (readiness !== undefined) return readiness
      probe()
      if (!ts) return (readiness = `typescript is not resolvable from ${root} — anchors on JS-family files need the host project's typescript: run 'npm i -D typescript', or remove the #anchor`)
      // resolvability is not usability: typescript@7 (the Go rewrite) may resolve yet not expose the JS
      // compiler API this extractor drives. Probe the ACTUAL surface with a tiny parse — an incompatible
      // host typescript is a loud error, never a silent pass or downgrade.
      try {
        const sf = ts.createSourceFile('probe.ts', 'const x = 1', ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
        if (!sf?.statements?.length || sf.parseDiagnostics?.length) throw new Error('probe parse failed')
        readiness = true
      } catch {
        readiness = `host typescript (v${ts?.version ?? 'unknown'}) resolves but its createSourceFile API is unusable (a TS7/Go build?) — pin 'npm i -D typescript@5', or remove the #anchor`
      }
      return readiness
    },
    extract(content, filename) {
      probe()
      if (!ts) throw new Error('ts-ast extractor is not ready (typescript unresolvable)')
      const kind = /\.(tsx)$/.test(filename) ? ts.ScriptKind.TSX
        : /\.(jsx)$/.test(filename) ? ts.ScriptKind.JSX
        : /\.(ts|mts|cts)$/.test(filename) ? ts.ScriptKind.TS
        : ts.ScriptKind.JS
      const sf = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true, kind)
      // parse-only gate: a file that does not parse yields GARBAGE units (a shell script's `x=$(...)`
      // parses as a const) — throw so the caller renders an honest "cannot parse" verdict instead.
      if (sf.parseDiagnostics?.length) throw new Error(`${filename} does not parse as ${ts.ScriptKind[kind]} (${sf.parseDiagnostics.length} syntax error(s))`)
      const line = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1
      const units: Unit[] = []
      const push = (name: string, ukind: string, node: any, typeOnly = false) =>
        units.push({ name, kind: ukind, start: line(node.getStart(sf)), end: line(node.end), ...(typeOnly ? { typeOnly } : {}) })
      for (const st of sf.statements) {
        if (ts.isFunctionDeclaration(st)) push(st.name ? st.name.text : '(default)', 'function', st)
        else if (ts.isClassDeclaration(st)) {
          const cname = st.name ? st.name.text : '(default)'
          push(cname, 'class', st)
          for (const m of st.members) {
            if ((ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) && m.body) {
              const mname = ts.isConstructorDeclaration(m) ? 'constructor' : (m.name && ts.isIdentifier(m.name) ? m.name.text : '(computed)')
              push(`${cname}.${mname}`, 'method', m)
            }
          }
        } else if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) {
            if (!ts.isIdentifier(d.name)) continue // destructuring — not anchorable by one name
            const fn = d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
            // range = the whole statement (multi-declarator lines co-move; each name shares the range)
            units.push({ name: d.name.text, kind: fn ? 'const-fn' : 'const-data', start: line(st.getStart(sf)), end: line(st.end) })
          }
        } else if (ts.isEnumDeclaration(st)) push(st.name.text, 'enum', st)
        else if (ts.isInterfaceDeclaration(st)) push(st.name.text, 'interface', st, true)
        else if (ts.isTypeAliasDeclaration(st)) push(st.name.text, 'type', st, true)
      }
      return units
    },
  }
}

// ---- extractor: heuristic(langSpec) — a generic regex engine fed LANGUAGE DATA, not language branches ----
// The designated extractor for languages described by a LangSpec row; adding a language = adding a data
// row + a registry entry (never a new engine). The JS family is deliberately NOT routed here (its
// designated extractor is ts-ast above); JS_LANG_R5B below exists as the validated reference row for the
// engine's shape and for the external benchmark to score.
export type LangSpec = {
  id: string
  extensions: string[]
  // column-0 declaration patterns; capture group 1 = the unit name (or the declarator list when declList)
  decls: {
    re: RegExp
    kind: string
    typeOnly?: boolean
    classOpener?: boolean
    declList?: boolean
    scopeOpener?: boolean
    memberOf?: { parentKind: string; kind: string }
  }[]
  // class-member pattern, active while inside a classOpener's balanced-bracket body (name -> Class.name)
  member?: { re: RegExp; blacklist?: RegExp }
  // indentation-significant languages use declaration nesting for qualified names and ranges. The
  // declaration regexes remain language data; this only selects a generic boundary strategy.
  indentScopes?: { decorator?: RegExp }
  // a column-0 line matching this ENDS the previous unit (comment-aware so trailing comment blocks
  // attach to the NEXT unit, not the previous one)
  boundary: RegExp
}

const balance = (s: string) => { let n = 0; for (const ch of s) { if ('([{'.includes(ch)) n++; else if (')]}'.includes(ch)) n-- } return n }
// split a declarator-list head on top-level commas: `COLS = 220, ROWS = 50` -> [COLS, ROWS]
function declNames(head: string): string[] {
  let d = 0, seg = ''
  const segs: string[] = []
  for (const ch of head) {
    if ('([{<'.includes(ch)) d++
    else if (')]}>'.includes(ch)) d--
    if (ch === ',' && d === 0) { segs.push(seg); seg = '' } else seg += ch
  }
  segs.push(seg)
  return segs.map((s) => s.match(/^\s*([A-Za-z_$][\w$]*)\s*(?::|=|$)/)?.[1]).filter((x): x is string => !!x)
}

const indentation = (line: string): number => {
  let n = 0
  for (const ch of line) {
    if (ch === ' ') n++
    else if (ch === '\t') n += 8 - (n % 8)
    else break
  }
  return n
}

function extractIndentScoped(content: string, spec: LangSpec): Unit[] {
  const lines = content.split('\n')
  type ScopedUnit = Unit & { declaration: number; indent: number }
  const units: ScopedUnit[] = []
  const scopes: { indent: number; name: string; kind: string }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || /^\s*#/.test(line)) continue
    const indent = indentation(line)
    while (scopes.length && scopes[scopes.length - 1].indent >= indent) scopes.pop()
    for (const d of spec.decls) {
      const m = line.match(d.re)
      if (!m) continue
      const local = m[1]
      const name = [...scopes.map((s) => s.name), local].join('.')
      const parent = scopes[scopes.length - 1]
      const kind = d.memberOf && parent?.kind === d.memberOf.parentKind ? d.memberOf.kind : d.kind
      let start = i + 1
      if (spec.indentScopes?.decorator) {
        for (let j = i - 1; j >= 0; j--) {
          if (indentation(lines[j]) !== indent || !spec.indentScopes.decorator.test(lines[j])) break
          start = j + 1
        }
      }
      units.push({ name, kind, start, end: i + 1, declaration: i, indent, ...(d.typeOnly ? { typeOnly: true } : {}) })
      if (d.scopeOpener) scopes.push({ indent, name: local, kind: d.kind })
      break
    }
  }

  for (const unit of units) {
    let boundary: number | null = null
    for (let i = unit.declaration + 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line.trim()) continue
      const indent = indentation(line)
      if (/^\s*#/.test(line)) {
        if (indent <= unit.indent && boundary === null) boundary = i
        continue
      }
      if (indent <= unit.indent) { boundary ??= i; break }
      boundary = null
    }
    unit.end = Math.max(unit.start, (boundary ?? lines.length) )
  }
  return units.map(({ declaration: _declaration, indent: _indent, ...unit }) => unit)
}

export function heuristicExtractor(spec: LangSpec): Extractor {
  return {
    id: spec.id,
    claims: (ext) => spec.extensions.includes(ext),
    ready: () => true,
    extract(content) {
      if (spec.indentScopes) return extractIndentScoped(content, spec)
      const lines = content.split('\n')
      const units: Unit[] = []
      let cls: string | null = null, depth = 0
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]
        if (cls) {
          const m = spec.member && l.match(spec.member.re)
          if (m && !spec.member!.blacklist?.test(m[1])) units.push({ name: `${cls}.${m[1]}`, kind: 'method', start: i + 1, end: i + 1 })
          depth += balance(l)
          if (depth <= 0) cls = null
          continue
        }
        for (const d of spec.decls) {
          const m = l.match(d.re)
          if (!m) continue
          for (const name of d.declList ? declNames(m[1]) : [m[1]])
            units.push({ name, kind: d.kind, start: i + 1, end: i + 1, ...(d.typeOnly ? { typeOnly: true } : {}) })
          if (d.classOpener) { cls = m[1]; depth = balance(l) }
          break
        }
      }
      // R5b ranges: a unit ends before the next column-0 boundary line; a method is also capped by the
      // next unit's start (methods sit inside their class's indentation, below boundary's radar).
      const bset: number[] = []
      for (let i = 0; i < lines.length; i++) if (spec.boundary.test(lines[i])) bset.push(i + 1)
      const starts = units.map((u) => u.start).sort((a, b) => a - b)
      for (const u of units) {
        const nb = bset.find((b) => b > u.start)
        let end = nb ?? lines.length + 1
        if (u.kind === 'method') { const ns = starts.find((x) => x > u.start); if (ns && ns < end) end = ns }
        u.end = Math.max(u.start, end - 1)
      }
      return units
    },
  }
}

// The validated JS-family reference row (R5b: name precision 99.7% / recall 100% / range 98.9% on the
// 41-file oracle) — NOT registered for JS (ts-ast is designated); kept as the engine's reference shape
// and the benchmark's scoring subject.
export const JS_LANG_R5B: LangSpec = {
  id: 'heuristic-js',
  extensions: [...JS_EXTS],
  decls: [
    { re: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/, kind: 'function' },
    { re: /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class', classOpener: true },
    { re: /^(?:export\s+)?(?:declare\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: 'enum' },
    { re: /^(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface', typeOnly: true },
    { re: /^(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)/, kind: 'type', typeOnly: true },
    { re: /^(?:export\s+)?(?:const|let|var)\s+(.+)$/, kind: 'const', declList: true },
  ],
  member: {
    re: /^\s+(?:(?:public|private|protected|static|readonly|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(/,
    blacklist: /^(if|for|while|switch|return|catch|new|await|typeof|throw|else|do)$/,
  },
  boundary: /^(?:[A-Za-z_$]|\/\/|\/\*)/,
}

// Python is a LangSpec DATA row over the same generic engine: declaration names come from patterns;
// significant indentation supplies lexical qualification and ranges. It is intentionally structural,
// not a Python runtime or full grammar (the user-facing boundary is documented by [[code-anchor]]).
const PY_ID = String.raw`[\p{ID_Start}_][\p{ID_Continue}_]*`
export const PYTHON_LANG: LangSpec = {
  id: 'heuristic-python',
  extensions: ['py', 'pyi'],
  decls: [
    {
      re: new RegExp(`^\\s*(?:async\\s+)?def\\s+(${PY_ID})\\s*\\(`, 'u'),
      kind: 'function',
      scopeOpener: true,
      memberOf: { parentKind: 'class', kind: 'method' },
    },
    { re: new RegExp(`^\\s*class\\s+(${PY_ID})(?:\\s*\\(|\\s*:)`, 'u'), kind: 'class', scopeOpener: true },
  ],
  indentScopes: { decorator: /^\s*@/ },
  boundary: /^\S/,
}

// ---- registry: extension -> its ONE designated extractor ----
// The registry's shape is the Extractor INTERFACE, not any engine: a future language row may be a
// heuristicExtractor(LangSpec) or a web-tree-sitter extractor carrying its own wasm-grammar/query
// config — whatever the implementation needs rides inside its own factory, never in the registry.
export function extractors(root: string): Extractor[] {
  return [tsAstExtractor(root), ...[PYTHON_LANG].map(heuristicExtractor)]
}
// first claiming extractor IS the designation (the registry order defines it); null = no anchor support
// for this language yet (lint ERRORS — the remedy is a LangSpec data row, or dropping the anchor).
export function extractorFor(regs: Extractor[], ext: string): Extractor | null {
  return regs.find((x) => x.claims(ext)) ?? null
}
export const extOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1) : ''
}

// ---- anchor resolution (language-agnostic) ----
export type AnchorResolution = { ok: Unit } | { dead: true } | { ambiguous: number }
export function resolveAnchor(units: Unit[], symbol: string): AnchorResolution {
  const hits = units.filter((u) => u.name === symbol)
  if (!hits.length) return { dead: true }
  if (hits.length > 1) return { ambiguous: hits.length }
  return { ok: hits[0] }
}

// ---- the historical hit engine (language-agnostic; batch short-lived git, no resident process) ----

// units of a file AS OF a commit, memoized by (blob oid, extractor id) — a blob is immutable, so the
// memo never invalidates; distinct file versions in a window are few. 'absent' = no blob at that commit;
// 'unparseable' = the extractor rejected that version's content (the caller treats it conservatively).
type BlobUnits = { units: Unit[] } | { absent: true } | { unparseable: string }
const unitMemo = new Map<string, BlobUnits>()
const MEMO_MAX = 4096
async function unitsAt(root: string, commit: string, path: string, x: Extractor): Promise<BlobUnits> {
  const oid = (await gitA(['-C', root, 'rev-parse', `${commit}:${path}`])).trim()
  if (!oid) return { absent: true }
  const key = `${oid}\0${x.id}`
  const hit = unitMemo.get(key)
  if (hit) return hit
  const text = await gitA(['-C', root, 'cat-file', 'blob', oid])
  let v: BlobUnits
  try { v = { units: x.extract(text, path) } } catch (e: any) { v = { unparseable: e?.message ?? String(e) } }
  if (unitMemo.size >= MEMO_MAX) unitMemo.clear()
  unitMemo.set(key, v)
  return v
}

// post-image line ranges of one commit's diff to one file (`@@ -a,b +c,d @@`, --unified=0). d>0 → lines
// c..c+d-1 changed; d==0 (pure deletion) → the point line after which content vanished. Immutable per
// (commit, file), memoized.
const hunkMemo = new Map<string, [number, number][]>()
async function hunksAt(root: string, commit: string, path: string): Promise<[number, number][]> {
  const key = `${commit}\0${path}`
  const hit = hunkMemo.get(key)
  if (hit) return hit
  const out = await gitA(['-C', root, '-c', 'core.quotePath=false', 'show', '--unified=0', '--format=', commit, '--', path])
  const ranges: [number, number][] = []
  for (const m of out.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const c = +m[1], d = m[2] === undefined ? 1 : +m[2]
    ranges.push(d > 0 ? [c, c + d - 1] : [Math.max(1, c), Math.max(1, c)])
  }
  if (hunkMemo.size >= MEMO_MAX) hunkMemo.clear()
  hunkMemo.set(key, ranges)
  return ranges
}

// the drift window of an anchored file: every commit to `path` not reachable from the spec's version
// and not covered by a valid Spec-OK ack — the SAME set driftFor counts, exposed as commits so the
// anchor engine can probe each one. (fileCommits comes from a --name-only walk, which lists no files
// for merge commits — the window is non-merge by construction.)
export function windowCommits(idx: DriftIndex, sinceHash: string, path: string): string[] {
  if (!sinceHash) return []
  const base = ancestorsOf(idx, sinceHash)
  if (!base) return []
  const cover = ackCoverFor(idx, sinceHash)
  return (idx.fileCommits.get(path) ?? []).filter((h) => !inAncestors(idx, base, h) && !cover.some((a) => inAncestors(idx, a, h)))
}

// which window commits TOUCHED any of the anchored units: the commit's --unified=0 hunks intersect a
// unit's line range extracted from the file AS IT EXISTED AT THAT COMMIT (never from HEAD — units later
// renamed or moved still attribute correctly). Several selectors are OR — a commit appears ONCE, with
// `selectors` naming exactly which units its hunks intersected (so diagnostics can attribute the hit).
// A version whose content the extractor cannot parse is a CONSERVATIVE hit for every selector
// (`unparseable` set) — over-warn, never silently skip.
export type AnchorHit = { commit: string; selectors: string[]; unparseable?: string }
export async function anchorHitCommits(root: string, win: string[], path: string, symbols: string[], x: Extractor): Promise<AnchorHit[]> {
  const hits: AnchorHit[] = []
  for (const c of win) {
    const at = await unitsAt(root, c, path, x)
    if ('absent' in at) continue // file not in that commit's tree — nothing of the anchor to touch
    if ('unparseable' in at) { hits.push({ commit: c, selectors: [...symbols], unparseable: at.unparseable }); continue }
    const bySym = symbols
      .map((sym) => ({ sym, ranges: at.units.filter((u) => u.name === sym) }))
      .filter((s) => s.ranges.length) // a unit absent under this name at that commit can't be touched
    if (!bySym.length) continue
    const hunks = await hunksAt(root, c, path)
    const touched = bySym.filter((s) => hunks.some(([a, b]) => s.ranges.some((u) => a <= u.end && u.start <= b))).map((s) => s.sym)
    if (touched.length) hits.push({ commit: c, selectors: touched })
  }
  return hits
}
