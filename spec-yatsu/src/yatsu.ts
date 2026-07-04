import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, basename } from 'node:path'

export const YATSU_FILE = 'yatsu.md'
export const SIDECAR_FILE = 'yatsu.evals.ndjson'

export type Scenario = {
  name: string
  description: string
  expected: string
  tags?: string[]
  test?: string
  code?: string[]
  related?: string[]
}

export type YatsuNode = {
  id: string            // the node's leaf dir name (its spec-node id)
  dir: string           // absolute node directory
  yatsuPath: string     // repo-relative path to yatsu.md — the SCENARIO freshness axis
  sidecarPath: string   // absolute path to yatsu.evals.ndjson
  scenarios: Scenario[]
}

const SCENARIO_KEYS = ['name', 'description', 'expected', 'tags', 'test', 'code', 'related'] as const
type ScenarioKey = (typeof SCENARIO_KEYS)[number]
const LIST_KEYS: readonly ScenarioKey[] = ['tags', 'code', 'related']

// a raw scenario item straight off the frontmatter walk: the known fields it set, plus any UNKNOWN keys it
// carried — kept (not dropped) so the validator can name a typo'd field instead of silently swallowing it.
type RawItem = { fields: Partial<Record<ScenarioKey, string>>; unknownKeys: string[] }

// tiny indentation parser for yatsu.md's frontmatter `scenarios:` block (no YAML dep), shared by parseScenarios and validateScenarios so they can't disagree; reports hasFrontmatter/hasKey so the validator can tell "none declared" from "malformed"
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
      return {
        name: it.fields.name ?? '',
        description: it.fields.description ?? '',
        expected: it.fields.expected ?? '',
        ...(tags.length ? { tags } : {}),
        ...(it.fields.test ? { test: it.fields.test } : {}),
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
export function validateScenarios(src: string, tagLibrary: string[] = []): string[] {
  const { hasFrontmatter, hasKey, items } = walkScenarios(src)
  if (!hasFrontmatter) return ['no frontmatter block — a yatsu.md must declare a `scenarios:` list']
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
    if (it.fields.name) counts.set(it.fields.name, (counts.get(it.fields.name) ?? 0) + 1)
  })
  for (const [n, c] of counts) if (c > 1) errs.push(`duplicate scenario name '${n}' (${c}×) — names must be unique within a yatsu.md`)
  return errs
}

// walk `.spec` for every dir holding a yatsu.md; a node's id is its leaf dir name (the same its spec.md carries)
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

// async twin of yatsuNodes for the HOT board build ([[board-cache]]): reading each yatsu.md through
// fs/promises YIELDS the event loop between files, so the walk no longer stalls a `/health` probe in one
// ~600ms uninterrupted stretch. Same output (id-sorted) as yatsuNodes; only buildBoard uses it, other
// callers keep the sync form.
export async function yatsuNodesAsync(root: string): Promise<YatsuNode[]> {
  const specDir = join(root, '.spec')
  const out: YatsuNode[] = []
  const stack = existsSync(specDir) ? [specDir] : []
  while (stack.length) {
    const dir = stack.pop()!
    let ents
    try { ents = await readdir(dir, { withFileTypes: true }) } catch { continue }
    if (existsSync(join(dir, YATSU_FILE))) {
      const yatsuPath = relative(root, join(dir, YATSU_FILE))
      out.push({
        id: basename(dir),
        dir,
        yatsuPath,
        sidecarPath: join(dir, SIDECAR_FILE),
        scenarios: parseScenarios(await readFile(join(dir, YATSU_FILE), 'utf8')),
      })
    }
    for (const e of ents) if (e.isDirectory()) stack.push(join(dir, e.name))
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}
