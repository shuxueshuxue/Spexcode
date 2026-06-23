import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, basename } from 'node:path'

// @@@ yatsu node model - a node declares its scenarios in a `yatsu.md` beside its `spec.md`. The
// scenarios say how to MEASURE the node's loss; the readings the agent files against them live in a flat
// `yatsu.evals.ndjson` sidecar in the same dir (the second git-as-database axis — see [[sidecar]]).
// A node has scenarios IFF it has a yatsu.md; the spec walk (spec-cli) is unchanged — yatsu.md is a
// sibling file it never looks at.

export const YATSU_FILE = 'yatsu.md'
export const SIDECAR_FILE = 'yatsu.evals.ndjson'

// @@@ Scenario - one declared way to measure the node's loss: a `description` (what to check), the
// `expected` result (what zero loss looks like), and OPTIONALLY a `test` (a repo path to a co-located
// runnable file — a playwright.spec.ts, a script — that the AGENT may run by hand; yatsu itself runs
// nothing) and `code` (concrete repo files THIS scenario depends on — its own slice of the node's code
// freshness axis, so two scenarios on one node go stale independently; absent → it inherits the whole
// node's `code:` list). `name` is its key in the sidecar; the bug-fix keystone (a repro becoming a
// regression scenario) appends one. There is no `driver`/`steps`-as-execution-mechanism: a scenario is a
// target the agent measures however it likes, not a script yatsu executes.
export type Scenario = {
  name: string
  description: string
  expected: string
  test?: string
  code?: string[]
}

export type YatsuNode = {
  id: string            // the node's leaf dir name (its spec-node id)
  dir: string           // absolute node directory
  yatsuPath: string     // repo-relative path to yatsu.md — the SCENARIO freshness axis
  sidecarPath: string   // absolute path to yatsu.evals.ndjson
  scenarios: Scenario[]
}

// @@@ scenario schema - the five fields a scenario may declare; `name`/`description`/`expected` are
// required, `test`/`code` optional. Anything else inside an item is a typo or mistake — validateScenarios
// rejects it loudly (the lenient parser below merely ignores it). One source of truth for both faces.
const SCENARIO_KEYS = ['name', 'description', 'expected', 'test', 'code'] as const
type ScenarioKey = (typeof SCENARIO_KEYS)[number]

// a raw scenario item straight off the frontmatter walk: the known fields it set, plus any UNKNOWN keys it
// carried — kept (not dropped) so the validator can name a typo'd field instead of silently swallowing it.
type RawItem = { fields: Partial<Record<ScenarioKey, string>>; unknownKeys: string[] }

// @@@ scenarios walk - the ONE indentation-driven pass over yatsu.md's frontmatter `scenarios:` block,
// shared by the lenient reader (parseScenarios) and the strict gate (validateScenarios) so the two can
// never disagree about what the file says. yatsu.md declares scenarios as a YAML block sequence of mappings
// (name/description/expected/test); the spec-cli frontmatter reader is scalar / flat-string-list only, so
// this is a small parser for exactly that shape — no YAML dependency, the same "deliberately tiny" spirit.
// Sequence items are the dashes at the shallowest indent after `scenarios:`; `key: value` lines deeper set
// the current item's fields; a value of `|`/`>` opens a block scalar (description/expected span lines). It
// reports whether the frontmatter and the `scenarios:` key were present at all, so the validator can tell
// "no scenarios declared" from "scenarios declared but malformed".
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
  // @@@ block-sequence code - `code:` (the one list field) may be written inline (`code: a, b`) OR as a YAML
  // block sequence — `- item` lines indented deeper, exactly like spec.md's `code:`. The scalar-only reader
  // can't see those lines, so collect them HERE into the comma form parseCodeList expects; without this they
  // would be silently dropped and the scenario would read as having no `code:` at all (a fail-silent footgun).
  if (key === 'code' && f[2].trim() === '') {
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
    if (items.length) { cur.fields.code = items.join(','); return j - 1 }
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

// a scenario's optional `code:` is a comma-separated path list (a YAML flow list `[a, b]` or bare `a, b`,
// or a single path) — the tiny parser stays scalar-only, so the list is split here from the stored string.
function parseCodeList(raw: string): string[] {
  return raw.replace(/^\[|\]$/g, '').split(',').map((s) => unquote(s.trim())).filter(Boolean)
}

// @@@ parseScenarios - the LENIENT reader every consumer (scan/eval/show) uses: clean Scenario[] off the
// walk, missing prose fields defaulting to '' and a nameless item dropped. Tolerant by design — the loud
// gate is validateScenarios (run at scan + pre-commit), so a malformed file is rejected THERE, not silently
// reshaped here.
export function parseScenarios(src: string): Scenario[] {
  return walkScenarios(src).items
    .map((it): Scenario => {
      const code = it.fields.code ? parseCodeList(it.fields.code) : []
      return {
        name: it.fields.name ?? '',
        description: it.fields.description ?? '',
        expected: it.fields.expected ?? '',
        ...(it.fields.test ? { test: it.fields.test } : {}),
        ...(code.length ? { code } : {}),
      }
    })
    .filter((s) => s.name)   // a scenario with no name is malformed — drop it (validateScenarios reports it)
}

// @@@ validateScenarios - the STRICT schema gate, the loud twin of parseScenarios. Returns one message per
// problem (empty array = valid). A yatsu.md must carry a frontmatter `scenarios:` list of at least one item,
// and every item must set a non-empty name + description + expected, declare no field outside the schema,
// and use a name unique within the file. PURE (src → errors) so both faces share it: `spex yatsu scan`
// emits each as a `yatsu-schema` finding, and the pre-commit backstop rejects a staged yatsu.md that fails
// — a malformed loss function never lands silently the way the lenient parser would have let it.
export function validateScenarios(src: string): string[] {
  const { hasFrontmatter, hasKey, items } = walkScenarios(src)
  if (!hasFrontmatter) return ['no frontmatter block — a yatsu.md must declare a `scenarios:` list']
  if (!hasKey) return ['frontmatter has no `scenarios:` key — declare at least one scenario']
  if (!items.length) return ['`scenarios:` declares no scenarios — add one (name + description + expected)']
  const errs: string[] = []
  const counts = new Map<string, number>()
  items.forEach((it, idx) => {
    const label = it.fields.name ? `scenario '${it.fields.name}'` : `scenario #${idx + 1}`
    for (const k of ['name', 'description', 'expected'] as const) {
      if (!it.fields[k]?.trim()) errs.push(`${label}: missing required field \`${k}\``)
    }
    for (const u of it.unknownKeys) errs.push(`${label}: unknown field \`${u}\` (allowed: ${SCENARIO_KEYS.join(', ')})`)
    if (it.fields.name) counts.set(it.fields.name, (counts.get(it.fields.name) ?? 0) + 1)
  })
  for (const [n, c] of counts) if (c > 1) errs.push(`duplicate scenario name '${n}' (${c}×) — names must be unique within a yatsu.md`)
  return errs
}

// @@@ yatsuNodes - walk `.spec` for every directory holding a yatsu.md and read its scenarios. The spec
// root is `<root>/.spec`; a yatsu node's id is its leaf dir name (the same id its spec.md carries).
export function yatsuNodes(root: string): YatsuNode[] {
  const specDir = join(root, '.spec')
  const out: YatsuNode[] = []
  const stack = existsSync(specDir) ? [specDir] : []
  while (stack.length) {
    const dir = stack.pop()!
    let ents
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    if (existsSync(join(dir, YATSU_FILE))) {
      const yatsuPath = relative(root, join(dir, YATSU_FILE))
      out.push({
        id: basename(dir),
        dir,
        yatsuPath,
        sidecarPath: join(dir, SIDECAR_FILE),
        scenarios: parseScenarios(readFileSync(join(dir, YATSU_FILE), 'utf8')),
      })
    }
    for (const e of ents) if (e.isDirectory()) stack.push(join(dir, e.name))
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}
