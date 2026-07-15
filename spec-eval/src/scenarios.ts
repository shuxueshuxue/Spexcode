import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative, basename } from 'node:path'
import { mintIds } from '../../spec-cli/src/specs.js'

export const EVAL_FILE = 'eval.md'
export const SIDECAR_FILE = 'evals.ndjson'

export type ScenarioTestReference = {
  path: string
  name?: string
}

export type Scenario = {
  name: string
  description: string
  expected: string
  tags?: string[]
  test?: ScenarioTestReference
  code?: string[]
  related?: string[]
}

export type EvalNode = {
  id: string            // the node's CANONICAL spec id (leaf name, '_'-disambiguated on a leaf collision)
  dir: string           // absolute node directory
  evalPath: string     // repo-relative path to eval.md — the SCENARIO freshness axis
  sidecarPath: string   // absolute path to evals.ndjson
  scenarios: Scenario[]
}

const SCENARIO_KEYS = ['name', 'description', 'expected', 'tags', 'test', 'code', 'related'] as const
type ScenarioKey = (typeof SCENARIO_KEYS)[number]
const LIST_KEYS: readonly ScenarioKey[] = ['tags', 'code', 'related']
const TEST_KEYS = ['path', 'name'] as const
type TestKey = (typeof TEST_KEYS)[number]

type RawTestObject = {
  fields: Partial<Record<TestKey, string>>
  unknownKeys: string[]
  duplicateKeys: string[]
  malformed: string[]
}

// a raw scenario item straight off the frontmatter walk: the known fields it set, plus any UNKNOWN keys it
// carried — kept (not dropped) so the validator can name a typo'd field instead of silently swallowing it.
type RawItem = { fields: Partial<Record<ScenarioKey, string>>; testObject?: RawTestObject; unknownKeys: string[] }

// tiny indentation parser for eval.md's frontmatter `scenarios:` block (no YAML dep), shared by parseScenarios and validateScenarios so they can't disagree; reports hasFrontmatter/hasKey so the validator can tell "none declared" from "malformed"
function walkScenarios(src: string): { hasFrontmatter: boolean; hasKey: boolean; items: RawItem[] } {
  const m = src.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return { hasFrontmatter: false, hasKey: false, items: [] }
  const lines = m[1].split('\n')
  let i = lines.findIndex((l) => /^scenarios:\s*$/.test(l))
  if (i < 0) return { hasFrontmatter: true, hasKey: false, items: [] }
  const items: RawItem[] = []
  let cur: RawItem | null = null
  let itemIndent = -1            // the indent of the `- ` that starts each scenario (set by the first one)
  const indentOf = (l: string) => l.length - l.replace(/^\s+/, '').length
  for (i++; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const indent = indentOf(line)
    if (indent === 0) break       // dedented to another top-level key — scenarios block is done
    const trimmed = line.trim()
    const dash = trimmed.startsWith('- ') || trimmed === '-'
    if (dash && (itemIndent < 0 || indent <= itemIndent)) {
      // a new scenario item. start fresh; the `- ` may carry the first field inline.
      cur = { fields: {}, unknownKeys: [] }
      items.push(cur)
      itemIndent = indent
      const inline = trimmed.slice(1).trim()   // text after the dash
      if (inline) i = assignField(cur, inline, lines, i, indent)
      continue
    }
    if (!cur) continue            // content before the first dash — ignore
    i = assignField(cur, trimmed, lines, i, indent)
  }
  return { hasFrontmatter: true, hasKey: true, items }
}

// assign a `key: value` field to the current item. When the value is a block-scalar indicator (`|`
// literal / `>` folded), consume the following more-indented lines as the value and return the index of
// the LAST consumed line (the for-loop's ++ then moves past it); otherwise return `idx` unchanged. A key
// outside the schema is recorded under unknownKeys (still consuming its block, so the body isn't misread as
// new items) rather than dropped — validateScenarios needs to see it to reject the typo.
function assignField(cur: RawItem, kv: string, lines: string[], idx: number, keyIndent: number): number {
  const f = kv.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
  if (!f) return idx
  const key = f[1]
  if (key === 'test') {
    const raw = f[2].trim()
    if (!raw) {
      const parsed = emptyTestObject()
      let childIndent = -1
      let j = idx + 1
      for (; j < lines.length; j++) {
        const line = lines[j]
        if (!line.trim()) continue
        const indent = line.length - line.replace(/^\s+/, '').length
        if (indent <= keyIndent) break
        if (childIndent < 0) childIndent = indent
        if (indent !== childIndent) {
          parsed.malformed.push(`invalid nested test object entry \`${line.trim()}\``)
          continue
        }
        assignTestField(parsed, line.trim())
      }
      cur.testObject = parsed
      return j - 1
    }
    if (raw.startsWith('{') || raw.endsWith('}')) {
      cur.testObject = parseFlowTestObject(raw)
      return idx
    }
  }
  // a list field (`code:`/`related:`) may be a YAML block sequence (`- item` lines); the scalar reader can't see those, so collect them here into the comma form parseCodeList expects
  if ((LIST_KEYS as readonly string[]).includes(key) && f[2].trim() === '') {
    const items: string[] = []
    let j = idx + 1
    for (; j < lines.length; j++) {
      const l = lines[j]
      if (!l.trim()) continue
      const ind = l.length - l.replace(/^\s+/, '').length
      if (ind <= keyIndent) break
      const it = l.trim().match(/^-\s*(.+)$/)
      if (!it) break
      items.push(unquote(it[1]))
    }
    if (items.length) { cur.fields[key as ScenarioKey] = items.join(','); return j - 1 }
  }
  let value: string
  let end = idx
  const block = f[2].match(/^([|>])[+-]?\s*$/)
  if (block) {
    const fold = block[1] === '>'
    const body: string[] = []
    let base = -1, j = idx + 1
    for (; j < lines.length; j++) {
      const l = lines[j]
      if (!l.trim()) { body.push(''); continue }
      const ind = l.length - l.replace(/^\s+/, '').length
      if (ind <= keyIndent) break   // dedented to a sibling field / next item → the block is done
      if (base < 0) base = ind
      body.push(l.slice(base))
    }
    while (body.length && body[body.length - 1] === '') body.pop()   // strip trailing blanks
    value = fold ? body.join(' ').replace(/\s+/g, ' ').trim() : body.join('\n')
    end = j - 1
  } else {
    value = unquote(f[2])
  }
  if ((SCENARIO_KEYS as readonly string[]).includes(key)) cur.fields[key as ScenarioKey] = value
  else cur.unknownKeys.push(key)
  return end
}

const unquote = (s: string) => s.replace(/^["'](.*)["']$/, '$1').trim()

const emptyTestObject = (): RawTestObject => ({ fields: {}, unknownKeys: [], duplicateKeys: [], malformed: [] })

function testValue(raw: string, opaque = false): string {
  const value = raw.trim()
  const quoted = value.match(/^(["'])([\s\S]*)\1$/)
  return quoted ? quoted[2] : opaque ? value : unquote(value)
}

function assignTestField(obj: RawTestObject, entry: string): void {
  const f = entry.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
  if (!f) { obj.malformed.push(`invalid test object entry \`${entry}\``); return }
  const key = f[1]
  if (!(TEST_KEYS as readonly string[]).includes(key)) { obj.unknownKeys.push(key); return }
  if (key in obj.fields) obj.duplicateKeys.push(key)
  obj.fields[key as TestKey] = testValue(f[2], key === 'name')
}

// A flow mapping is accepted beside the more readable block form. Split only on commas outside quotes so
// an opaque case name such as "allows admin, user" survives byte-for-byte after YAML quote removal.
function parseFlowTestObject(raw: string): RawTestObject {
  const obj = emptyTestObject()
  if (!raw.startsWith('{') || !raw.endsWith('}')) {
    obj.malformed.push('`test` object must be a mapping with exactly `path` and `name`')
    return obj
  }
  const body = raw.slice(1, -1).trim()
  if (!body) return obj
  const entries: string[] = []
  let start = 0
  let quote = ''
  let escaped = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quote) {
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === ',') { entries.push(body.slice(start, i).trim()); start = i + 1 }
  }
  if (quote) obj.malformed.push('`test` object has an unterminated quoted value')
  entries.push(body.slice(start).trim())
  for (const entry of entries) assignTestField(obj, entry)
  return obj
}

function normalizedTest(it: RawItem): ScenarioTestReference | undefined {
  if (it.testObject) {
    const path = it.testObject.fields.path
    if (!path) return undefined
    const name = it.testObject.fields.name
    return { path, ...(name ? { name } : {}) }
  }
  const path = it.fields.test
  return path ? { path } : undefined
}

// @@@scenario contract hash - the deterministic content hash of a scenario's SEMANTIC text, stamped on each
// reading at filing time ([[eval-core]]'s scenario freshness axis). Hashes ONLY the measurement contract —
// description (what to measure) + expected (what zero loss looks like) — never name/tags/test/code/related.
// Normalization (spec'd, don't drift): each field independently collapses every whitespace run (space, tab,
// CR, LF) to a single space and trims its ends, so a prose re-wrap, an indent shift, CRLF churn or trailing
// whitespace never changes the hash; the two normalized fields join with a single '\n' (neither can contain
// one after normalization, so the join is unambiguous) and sha256-hex the UTF-8 bytes. The hash is pure text
// over the parsed declaration — no git, no file position — so it is identical wherever and however the same
// contract text is read.
const normSemantic = (s: string) => s.replace(/\s+/g, ' ').trim()
export function scenarioHash(s: Pick<Scenario, 'description' | 'expected'>): string {
  return createHash('sha256').update(`${normSemantic(s.description)}\n${normSemantic(s.expected)}`, 'utf8').digest('hex')
}

// a scenario's optional list field (`code:`/`related:`) is a comma-separated path list (a YAML flow list
// `[a, b]` or bare `a, b`, or a single path) — the tiny parser stays scalar-only, so it is split here.
function parseCodeList(raw: string): string[] {
  return raw.replace(/^\[|\]$/g, '').split(',').map((s) => unquote(s.trim())).filter(Boolean)
}

export function parseScenarios(src: string): Scenario[] {
  return walkScenarios(src).items
    .map((it): Scenario => {
      const tags = it.fields.tags ? parseCodeList(it.fields.tags) : []
      const code = it.fields.code ? parseCodeList(it.fields.code) : []
      const related = it.fields.related ? parseCodeList(it.fields.related) : []
      const test = normalizedTest(it)
      return {
        name: it.fields.name ?? '',
        description: it.fields.description ?? '',
        expected: it.fields.expected ?? '',
        ...(tags.length ? { tags } : {}),
        ...(test ? { test } : {}),
        ...(code.length ? { code } : {}),
        ...(related.length ? { related } : {}),
      }
    })
    .filter((s) => s.name)   // a scenario with no name is malformed — drop it (validateScenarios reports it)
}

// `tagLibrary` is the closed vocabulary a scenario's `tags:` must draw from (config's `lint.scenarioTags`).
// Every scenario needs ≥1 tag; each tag must be IN the library — an out-of-library tag is rejected LOUD with
// the repair the user owns: pick an existing tag, or extend the library. An empty library (none configured)
// disables only the membership check, never the ≥1-tag requirement.
export function validateScenarios(src: string, tagLibrary: string[] = [], pathRoot?: string): string[] {
  const { hasFrontmatter, hasKey, items } = walkScenarios(src)
  if (!hasFrontmatter) return ['no frontmatter block — an eval.md must declare a `scenarios:` list']
  if (!hasKey) return ['frontmatter has no `scenarios:` key — declare at least one scenario']
  if (!items.length) return ['`scenarios:` declares no scenarios — add one (name + description + expected)']
  const errs: string[] = []
  const counts = new Map<string, number>()
  const lib = tagLibrary.length ? ` (library: ${tagLibrary.join(', ')})` : ''
  items.forEach((it, idx) => {
    const label = it.fields.name ? `scenario '${it.fields.name}'` : `scenario #${idx + 1}`
    for (const k of ['name', 'description', 'expected'] as const) {
      if (!it.fields[k]?.trim()) errs.push(`${label}: missing required field \`${k}\``)
    }
    const tags = it.fields.tags ? parseCodeList(it.fields.tags) : []
    if (!tags.length) {
      errs.push(`${label}: missing required field \`tags\` — every scenario needs ≥1 tag from the library${lib}; pick one, or add a new tag to lint.scenarioTags in spexcode.json to create it`)
    } else if (tagLibrary.length) {
      for (const t of tags) if (!tagLibrary.includes(t)) {
        errs.push(`${label}: tag \`${t}\` is not in the configured tag library${lib} — use an existing tag, or add \`${t}\` to lint.scenarioTags in spexcode.json to create it`)
      }
    }
    for (const u of it.unknownKeys) errs.push(`${label}: unknown field \`${u}\` (allowed: ${SCENARIO_KEYS.join(', ')})`)
    if (it.testObject) {
      for (const u of it.testObject.unknownKeys) errs.push(`${label}: unknown \`test\` field \`${u}\` (allowed: ${TEST_KEYS.join(', ')})`)
      for (const d of it.testObject.duplicateKeys) errs.push(`${label}: duplicate \`test.${d}\` field`)
      for (const e of it.testObject.malformed) errs.push(`${label}: ${e}`)
      for (const k of TEST_KEYS) if (!it.testObject.fields[k]?.length) errs.push(`${label}: \`test\` object missing required field \`${k}\``)
    } else if ('test' in it.fields && !it.fields.test?.length) {
      errs.push(`${label}: \`test\` scalar path must not be empty`)
    }
    const test = normalizedTest(it)
    if (test && pathRoot && !existsSync(join(pathRoot, test.path))) {
      errs.push(`${label}: \`test.path\` not found: ${test.path}`)
    }
    if (it.fields.name) counts.set(it.fields.name, (counts.get(it.fields.name) ?? 0) + 1)
  })
  for (const [n, c] of counts) if (c > 1) errs.push(`duplicate scenario name '${n}' (${c}×) — names must be unique within an eval.md`)
  return errs
}

// walk `.spec` for every dir holding an eval.md; the node id is its CANONICAL spec id ([[id-url-safe]]) —
// minted by the SAME rule as specs.ts's loader (mintIds: the leaf dir name, or on a leaf collision the
// shortest globally-unique '_'-joined trailing suffix) over the SAME universe (every dir holding a spec.md,
// not just the eval subset — a leaf that collides among spec nodes is disambiguated even when only one of
// them measures). So the id eval verbs answer to is exactly the id board/scan/search already print — never a
// second, diverging bare-leaf scheme. An eval.md beside no spec.md keeps its leaf name (no spec id to align with).
function assembleNodes(root: string, specDirs: string[], hits: { dir: string; src: string }[]): EvalNode[] {
  const specBase = join(root, '.spec')
  const ids = mintIds(specDirs.map((d) => relative(specBase, d).split(/[/\\]/)))
  const idByDir = new Map(specDirs.map((d, i) => [d, ids[i]]))
  return hits
    .map(({ dir, src }) => ({
      id: idByDir.get(dir) ?? basename(dir),
      dir,
      evalPath: relative(root, join(dir, EVAL_FILE)),
      sidecarPath: join(dir, SIDECAR_FILE),
      scenarios: parseScenarios(src),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function evalNodes(root: string): EvalNode[] {
  const specDir = join(root, '.spec')
  const specDirs: string[] = []
  const hits: { dir: string; src: string }[] = []
  const stack = existsSync(specDir) ? [specDir] : []
  while (stack.length) {
    const dir = stack.pop()!
    let ents
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    if (existsSync(join(dir, 'spec.md'))) specDirs.push(dir)
    if (existsSync(join(dir, EVAL_FILE))) hits.push({ dir, src: readFileSync(join(dir, EVAL_FILE), 'utf8') })
    for (const e of ents) if (e.isDirectory()) stack.push(join(dir, e.name))
  }
  return assembleNodes(root, specDirs, hits)
}

// async twin of evalNodes for the HOT board build ([[graph-cache]]): reading each eval.md through
// fs/promises YIELDS the event loop between files, so the walk no longer stalls a `/health` probe in one
// ~600ms uninterrupted stretch. Same output (canonical ids, id-sorted) as evalNodes; only buildBoard uses
// it, other callers keep the sync form.
export async function evalNodesAsync(root: string): Promise<EvalNode[]> {
  const specDir = join(root, '.spec')
  const specDirs: string[] = []
  const hits: { dir: string; src: string }[] = []
  const stack = existsSync(specDir) ? [specDir] : []
  while (stack.length) {
    const dir = stack.pop()!
    let ents
    try { ents = await readdir(dir, { withFileTypes: true }) } catch { continue }
    if (existsSync(join(dir, 'spec.md'))) specDirs.push(dir)
    if (existsSync(join(dir, EVAL_FILE))) hits.push({ dir, src: await readFile(join(dir, EVAL_FILE), 'utf8') })
    for (const e of ents) if (e.isDirectory()) stack.push(join(dir, e.name))
  }
  return assembleNodes(root, specDirs, hits)
}

export type EvalResolution<T> = { ok: true; node: T } | { ok: false; ambiguous: boolean; error: string }

// resolve a user-supplied node ref against the measurable set: an EXACT canonical id always wins; a bare leaf
// name stays the convenience it always was while it names exactly ONE measurable node; a leaf several nodes
// share fails LOUD listing the candidate canonical ids — never an arbitrary first hit, so a reading can
// only land on the node the caller actually named.
export function resolveEvalNode<T extends Pick<EvalNode, 'id' | 'dir'>>(nodes: T[], ref: string): EvalResolution<T> {
  const exact = nodes.find((n) => n.id === ref)
  if (exact) return { ok: true, node: exact }
  const byLeaf = nodes.filter((n) => basename(n.dir) === ref)
  if (byLeaf.length === 1) return { ok: true, node: byLeaf[0] }
  if (byLeaf.length > 1) {
    return { ok: false, ambiguous: true, error: `'${ref}' is ambiguous — ${byLeaf.length} measurable nodes share that leaf name; use a canonical id: ${byLeaf.map((n) => n.id).sort().join(', ')}` }
  }
  return { ok: false, ambiguous: false, error: `no measurable node '${ref}' (a node needs an eval.md)` }
}
