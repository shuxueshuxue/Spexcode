import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative, basename } from 'node:path'
import { mintIds } from '../../spec-cli/src/specs.js'
import { parseRelation, type RelationEntry } from '../../spec-cli/src/anchors.js'
import { treeTextFiles } from '../../spec-cli/src/git.js'

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

export const SCENARIO_PROJECTION = 'spex.eval.scenario-index'
export const SCENARIO_SCHEMA_VERSION = 1
export type ScenarioSemanticRow = {
  node: string
  name: string
  description: string
  expected: string
  scenarioHash: string
  code: RelationEntry[]
  related: RelationEntry[]
  tags: string[]
}
export type ScenarioMeasurementRow = { test: ScenarioTestReference | null }
export type ScenarioProjectionRow = {
  semantic: ScenarioSemanticRow
  measurement: ScenarioMeasurementRow
}
export type ScenarioProjectionProvenance = { head: string | null; treeSha: string | null }
export type ScenarioProjection = {
  projection: typeof SCENARIO_PROJECTION
  schemaVersion: typeof SCENARIO_SCHEMA_VERSION
  provenance: ScenarioProjectionProvenance
  semanticIndexHash: string
  fullIndexHash: string
  rows: ScenarioProjectionRow[]
}

export type EvalNode = {
  id: string
  dir: string
  evalPath: string
  sidecarPath: string
  scenarios: Scenario[]
  evalSource?: string
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

type RawFieldLocation = { startLine: number; endLine: number; indent: string }

type RawItem = {
  fields: Partial<Record<ScenarioKey, string>>
  testObject?: RawTestObject
  unknownKeys: string[]
  duplicateKeys: string[]
  malformed: string[]
  locations: Partial<Record<ScenarioKey, RawFieldLocation>>
  fieldIndent?: string
}

const leadingIndent = (line: string): string => line.match(/^[ \t]*/)?.[0] ?? ''

// Keep parsing and validation on the same structural walk.
function walkScenarios(src: string): { hasFrontmatter: boolean; hasKey: boolean; items: RawItem[]; malformed: string[] } {
  const normalized = src.replace(/\r\n?/g, '\n')
  const m = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  if (!m) return { hasFrontmatter: false, hasKey: false, items: [], malformed: [] }
  const lines = m[1].split('\n')
  const scenarioKeys = lines.flatMap((line, index) => /^scenarios:\s*$/.test(line) ? [index] : [])
  let i = scenarioKeys[0] ?? -1
  if (i < 0) return { hasFrontmatter: true, hasKey: false, items: [], malformed: [] }
  const items: RawItem[] = []
  const malformed = scenarioKeys.length > 1
    ? [`duplicate top-level \`scenarios:\` key (${scenarioKeys.length}×) — eval.md must have exactly one declaration list`]
    : []
  let cur: RawItem | null = null
  let itemIndent = -1            // the indent of the `- ` that starts each scenario (set by the first one)
  for (i++; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const prefix = leadingIndent(line)
    if (prefix.includes('\t')) malformed.push(`line ${i + 2}: tab indentation is not valid in an eval.md scenario mapping`)
    const indent = prefix.length
    if (indent === 0) break       // dedented to another top-level key — scenarios block is done
    const trimmed = line.trim()
    const dash = trimmed.startsWith('- ') || trimmed === '-'
    if (dash && (itemIndent < 0 || indent <= itemIndent)) {
      cur = {
        fields: {}, unknownKeys: [], duplicateKeys: [], malformed: [], locations: {},
        ...(trimmed.slice(1).trim() ? { fieldIndent: `${prefix}  ` } : {}),
      }
      items.push(cur)
      itemIndent = indent
      const inline = trimmed.slice(1).trim()   // text after the dash
      if (inline) i = assignField(cur, inline, lines, i, indent, true)
      continue
    }
    if (!cur) {
      if (!trimmed.startsWith('#')) malformed.push(`invalid scenarios entry \`${trimmed}\` before the first scenario`)
      continue
    }
    if (!trimmed.startsWith('#')) {
      if (cur.fieldIndent === undefined) cur.fieldIndent = prefix
      else if (prefix !== cur.fieldIndent) {
        cur.malformed.push(`inconsistent scenario field indentation: expected ${cur.fieldIndent.length} spaces, got ${prefix.length}`)
      }
    }
    i = assignField(cur, trimmed, lines, i, indent)
  }
  return { hasFrontmatter: true, hasKey: true, items, malformed }
}

function assignField(cur: RawItem, kv: string, lines: string[], idx: number, keyIndent: number, inline = false): number {
  const f = kv.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
  if (!f) {
    if (!kv.startsWith('#')) cur.malformed.push(`invalid scenario entry \`${kv}\``)
    return idx
  }
  const key = f[1]
  const scenarioKey = (SCENARIO_KEYS as readonly string[]).includes(key) ? key as ScenarioKey : null
  const finish = (parserEnd: number, locationEnd = parserEnd): number => {
    if (scenarioKey) {
      if (cur.locations[scenarioKey]) cur.duplicateKeys.push(key)
      else cur.locations[scenarioKey] = {
        startLine: idx,
        endLine: locationEnd,
        indent: `${leadingIndent(lines[idx])}${inline ? '  ' : ''}`,
      }
    }
    return parserEnd
  }
  if (key === 'test') {
    const raw = f[2].trim()
    if (!raw) {
      const parsed = emptyTestObject()
      let childIndent = -1
      let lastChild = idx
      let j = idx + 1
      for (; j < lines.length; j++) {
        const line = lines[j]
        if (!line.trim()) continue
        const prefix = leadingIndent(line)
        if (prefix.includes('\t')) parsed.malformed.push(`tab indentation is not valid in nested \`test\` metadata`)
        const indent = prefix.length
        if (indent <= keyIndent) break
        lastChild = j
        if (childIndent < 0) childIndent = indent
        if (indent !== childIndent) {
          parsed.malformed.push(`invalid nested test object entry \`${line.trim()}\``)
          continue
        }
        assignTestField(parsed, line.trim())
      }
      cur.testObject = parsed
      return finish(j - 1, lastChild)
    }
    if (raw.startsWith('{') || raw.endsWith('}')) {
      cur.testObject = parseFlowTestObject(raw)
      return finish(idx)
    }
  }
  if ((LIST_KEYS as readonly string[]).includes(key) && f[2].trim() === '') {
    const items: string[] = []
    let lastItem = idx
    let j = idx + 1
    for (; j < lines.length; j++) {
      const l = lines[j]
      if (!l.trim()) continue
      const prefix = leadingIndent(l)
      if (prefix.includes('\t')) cur.malformed.push(`tab indentation is not valid in \`${key}\` metadata`)
      const ind = prefix.length
      if (ind <= keyIndent) break
      const it = l.trim().match(/^-\s*(.+)$/)
      if (!it) break
      items.push(unquote(it[1]))
      lastItem = j
    }
    if (items.length) { cur.fields[key as ScenarioKey] = items.join(','); return finish(j - 1, lastItem) }
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
      const spaces = l.match(/^ */)?.[0] ?? ''
      const tabBeforeContent = l[spaces.length] === '\t'
      const requiredIndent = base < 0 ? keyIndent + 1 : base
      const tabInIndent = tabBeforeContent && spaces.length < requiredIndent
      if (tabInIndent) cur.malformed.push(`tab indentation is not valid in block scalar \`${key}\``)
      if (!l.trim() && !tabBeforeContent) { body.push(''); continue }
      // A tab after the required indent is scalar content, not indentation.
      const ind = tabInIndent ? leadingIndent(l).length : spaces.length
      if (ind <= keyIndent) break   // dedented to a sibling field / next item → the block is done
      if (base < 0) base = ind
      else if (ind < base) cur.malformed.push(`inconsistent block scalar indentation in \`${key}\`: expected at least ${base} spaces, got ${ind}`)
      body.push(l.slice(base))
    }
    while (body.length && body[body.length - 1] === '') body.pop()   // strip trailing blanks
    value = fold ? body.join(' ').replace(/\s+/g, ' ').trim() : body.join('\n')
    end = j - 1
  } else {
    value = key === 'test' ? testValue(f[2]) : unquote(f[2])
  }
  if ((SCENARIO_KEYS as readonly string[]).includes(key)) cur.fields[key as ScenarioKey] = value
  else cur.unknownKeys.push(key)
  return finish(end)
}

const unquote = (s: string) => s.replace(/^["'](.*)["']$/, '$1').trim()

const emptyTestObject = (): RawTestObject => ({ fields: {}, unknownKeys: [], duplicateKeys: [], malformed: [] })

function testValue(raw: string, opaque = false): string {
  const value = raw.trim()
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) } catch { /* fall through to the parser's legacy quote handling */ }
  }
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

// Test names may contain commas inside quotes.
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

const normSemantic = (s: string) => s.replace(/\s+/g, ' ').trim()
export function scenarioHash(s: Pick<Scenario, 'description' | 'expected'>): string {
  return createHash('sha256').update(`${normSemantic(s.description)}\n${normSemantic(s.expected)}`, 'utf8').digest('hex')
}

export type ScenarioCodeAxis = { entries: RelationEntry[]; paths: string[]; problems: string[] }
export type ScenarioCodeAxisSource = readonly string[] | readonly RelationEntry[]
export function scenarioCodeAxis(scenarioCode: readonly string[] | undefined, nodeCode: ScenarioCodeAxisSource = []): ScenarioCodeAxis {
  const parsed = scenarioCode?.length
    ? parseRelation([...scenarioCode], 'code')
    : nodeCode.length && typeof nodeCode[0] !== 'string'
      ? { entries: (nodeCode as readonly RelationEntry[]).map((e) => ({ path: e.path, selectors: [...e.selectors] })), problems: [] }
      : parseRelation([...(nodeCode as readonly string[])], 'code')
  const { entries, problems } = parsed
  return { entries, paths: entries.map((e) => e.path), problems }
}

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
    .filter((s) => s.name)
}

const compareStable = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
const relationRows = (raw: readonly string[] | undefined, relation: 'code' | 'related'): RelationEntry[] =>
  parseRelation([...(raw ?? [])], relation).entries.map((entry) => ({ path: entry.path, selectors: [...entry.selectors] }))

const hashProjection = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')

const semanticOnly = (row: ScenarioProjectionRow): ScenarioSemanticRow => row.semantic

export function scenarioProjection(
  nodes: readonly Pick<EvalNode, 'id' | 'scenarios' | 'evalSource'>[],
  provenance: Partial<ScenarioProjectionProvenance> = {},
): ScenarioProjection {
  const rows: ScenarioProjectionRow[] = []
  for (const node of nodes) {
    if ('evalSource' in node && node.evalSource !== undefined) {
      const schemaErrors = validateScenarios(node.evalSource)
      const relationErrors = node.scenarios.flatMap((scenario) => [
        ...parseRelation(scenario.code ?? [], 'code').problems,
        ...parseRelation(scenario.related ?? [], 'related').problems,
      ])
      const errors = [...schemaErrors, ...relationErrors]
      if (errors.length) throw new Error(`node '${node.id}' has malformed eval.md:\n${errors.map((e) => `  - ${e}`).join('\n')}`)
    }
    for (const scenario of node.scenarios) rows.push({
      semantic: {
        node: node.id,
        name: scenario.name,
        description: scenario.description,
        expected: scenario.expected,
        scenarioHash: scenarioHash(scenario),
        code: relationRows(scenario.code, 'code'),
        related: relationRows(scenario.related, 'related'),
        tags: [...(scenario.tags ?? [])],
      },
      measurement: { test: scenario.test ? { ...scenario.test } : null },
    })
  }
  rows.sort((a, b) => {
    const node = compareStable(a.semantic.node, b.semantic.node)
    return node || compareStable(a.semantic.name, b.semantic.name)
  })
  const semanticRows = rows.map(semanticOnly)
  return {
    projection: SCENARIO_PROJECTION,
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    provenance: { head: provenance.head ?? null, treeSha: provenance.treeSha ?? null },
    semanticIndexHash: hashProjection(semanticRows),
    fullIndexHash: hashProjection(rows),
    rows,
  }
}

export function validateScenarios(src: string, tagLibrary: string[] = [], pathRoot?: string): string[] {
  const { hasFrontmatter, hasKey, items, malformed } = walkScenarios(src)
  if (!hasFrontmatter) return ['no frontmatter block — an eval.md must declare a `scenarios:` list']
  if (!hasKey) return ['frontmatter has no `scenarios:` key — declare at least one scenario']
  if (!items.length) return ['`scenarios:` declares no scenarios — add one (name + description + expected)']
  const errs: string[] = [...malformed]
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
    for (const entry of it.malformed) errs.push(`${label}: ${entry}`)
    for (const d of it.duplicateKeys) errs.push(`${label}: duplicate field \`${d}\``)
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

export type ScenarioMeasurementMetadataMutation =
  | { scenario: string; insert: { test: string | { path: string; name: string } } }
  | { scenario: string; delete: 'test' }

type ParsedMetadataMutation =
  | { scenario: string; action: 'insert'; test: ScenarioTestReference }
  | { scenario: string; action: 'delete' }

const recordOf = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

function parseMetadataMutation(value: unknown): ParsedMetadataMutation {
  const mutation = recordOf(value)
  if (!mutation || typeof mutation.scenario !== 'string' || !mutation.scenario.trim()) {
    throw new Error('a metadata mutation must name exactly one scenario with a non-empty `scenario` string')
  }
  const unknown = Object.keys(mutation).filter((key) => !['scenario', 'insert', 'delete'].includes(key))
  if (unknown.length) throw new Error(`metadata mutation has unknown field(s): ${unknown.join(', ')}`)
  const actions = ['insert', 'delete'].filter((key) => key in mutation)
  if (actions.length !== 1) throw new Error('a metadata mutation must contain exactly one action: `insert` or `delete`')

  if ('delete' in mutation) {
    if (mutation.delete !== 'test') throw new Error('`delete` must name exactly one measurement field: `test`')
    return { scenario: mutation.scenario, action: 'delete' }
  }

  const insert = recordOf(mutation.insert)
  if (!insert || Object.keys(insert).length !== 1 || !('test' in insert)) {
    throw new Error('`insert` must contain exactly one measurement field: `test`')
  }
  if (typeof insert.test === 'string') {
    if (!insert.test.trim()) throw new Error('`insert.test` path must be a non-empty string')
    return { scenario: mutation.scenario, action: 'insert', test: { path: insert.test } }
  }
  const test = recordOf(insert.test)
  if (!test || Object.keys(test).sort().join(',') !== 'name,path'
      || typeof test.path !== 'string' || !test.path.trim()
      || typeof test.name !== 'string' || !test.name.trim()) {
    throw new Error('`insert.test` must be a path string or an exact `{path,name}` string mapping')
  }
  return { scenario: mutation.scenario, action: 'insert', test: { path: test.path, name: test.name } }
}

function declarationLineEnding(source: string): '\n' | '\r\n' {
  const withoutCrlf = source.replace(/\r\n/g, '')
  if (withoutCrlf.includes('\r')) throw new Error('eval.md uses unsupported bare CR line endings')
  if (source.includes('\r\n') && withoutCrlf.includes('\n')) {
    throw new Error('eval.md mixes LF and CRLF line endings; normalize it before applying metadata')
  }
  return source.includes('\r\n') ? '\r\n' : '\n'
}

function malformedDeclaration(errors: string[]): Error {
  return new Error(`malformed eval.md:\n${errors.map((error) => `  - ${error}`).join('\n')}`)
}

export function writeScenarioMeasurementMetadata(source: string, request: unknown): string {
  const mutation = parseMetadataMutation(request)
  const beforeErrors = validateScenarios(source)
  if (beforeErrors.length) throw malformedDeclaration(beforeErrors)

  const walked = walkScenarios(source)
  const matches = walked.items.filter((item) => item.fields.name === mutation.scenario)
  if (matches.length !== 1) {
    throw new Error(matches.length
      ? `scenario '${mutation.scenario}' is ambiguous (${matches.length} declarations)`
      : `scenario '${mutation.scenario}' was not found in eval.md`)
  }
  const item = matches[0]
  const lineEnding = declarationLineEnding(source)
  const lines = source.split(lineEnding)

  if (mutation.action === 'insert') {
    if (item.locations.test) throw new Error(`scenario '${mutation.scenario}' already has \`test\`; refusing to overwrite authoritative metadata`)
    const tags = item.locations.tags
    if (!tags) throw new Error(`scenario '${mutation.scenario}' has no structural \`tags\` field`)
    const keyIndent = tags.indent
    const childIndent = `${tags.indent}  `
    const rendered = mutation.test.name === undefined
      ? [`${keyIndent}test: ${JSON.stringify(mutation.test.path)}`]
      : [
          `${keyIndent}test:`,
          `${childIndent}path: ${JSON.stringify(mutation.test.path)}`,
          `${childIndent}name: ${JSON.stringify(mutation.test.name)}`,
        ]
    lines.splice(tags.endLine + 2, 0, ...rendered)
  } else {
    const test = item.locations.test
    if (!test) throw new Error(`scenario '${mutation.scenario}' has no \`test\` field to delete`)
    lines.splice(test.startLine + 1, test.endLine - test.startLine + 1)
  }

  const proposed = lines.join(lineEnding)
  const afterErrors = validateScenarios(proposed)
  if (afterErrors.length) throw new Error(`metadata mutation produced ${malformedDeclaration(afterErrors).message}`)
  const after = parseScenarios(proposed).filter((scenario) => scenario.name === mutation.scenario)
  if (after.length !== 1) throw new Error(`metadata mutation lost the unique scenario '${mutation.scenario}'`)
  if (mutation.action === 'insert') {
    if (JSON.stringify(after[0].test) !== JSON.stringify(mutation.test)) {
      throw new Error(`metadata mutation did not round-trip the exact requested \`test\` mapping for scenario '${mutation.scenario}'`)
    }
  } else if (after[0].test !== undefined) {
    throw new Error(`metadata mutation did not delete \`test\` from scenario '${mutation.scenario}'`)
  }
  return proposed
}

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
      evalSource: src,
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

export function evalNodesAt(root: string, tip: string): EvalNode[] {
  const files = treeTextFiles(root, tip, '.spec')
  const paths = [...files.keys()]
  const specDirs = paths
    .filter((path) => path.endsWith('/spec.md'))
    .map((path) => join(root, path.slice(0, -'/spec.md'.length)))
  const hits = paths
    .filter((path) => path.endsWith(`/${EVAL_FILE}`))
    .map((path) => ({
      dir: join(root, path.slice(0, -`/${EVAL_FILE}`.length)),
      src: files.get(path)!,
    }))
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
