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
// nothing). `name` is its key in the sidecar; the bug-fix keystone (a repro becoming a regression
// scenario) appends one. There is no `driver`/`steps`-as-execution-mechanism: a scenario is a target the
// agent measures however it likes, not a script yatsu executes.
export type Scenario = {
  name: string
  description: string
  expected: string
  test?: string
}

export type YatsuNode = {
  id: string            // the node's leaf dir name (its spec-node id)
  dir: string           // absolute node directory
  yatsuPath: string     // repo-relative path to yatsu.md — the SCENARIO freshness axis
  sidecarPath: string   // absolute path to yatsu.evals.ndjson
  scenarios: Scenario[]
}

// @@@ scenarios parser - yatsu.md declares scenarios in a frontmatter `scenarios:` block: a YAML block
// sequence of mappings (name/description/expected/test). The spec-cli frontmatter reader is scalar /
// flat-string-list only, so this is a small indentation-driven parser for exactly that shape — no YAML
// dependency, the same "deliberately tiny" spirit. Sequence items are the dashes at the shallowest indent
// after `scenarios:`; `key: value` lines deeper set the current item's fields; a value of `|` or `>`
// opens a block scalar (the prose fields, description/expected, want to span lines).
export function parseScenarios(src: string): Scenario[] {
  const m = src.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return []
  const lines = m[1].split('\n')
  let i = lines.findIndex((l) => /^scenarios:\s*$/.test(l))
  if (i < 0) return []
  const out: Partial<Scenario>[] = []
  let cur: Partial<Scenario> | null = null
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
      cur = {}
      out.push(cur)
      itemIndent = indent
      const inline = trimmed.slice(1).trim()   // text after the dash
      if (inline) i = assignField(cur, inline, lines, i, indent)
      continue
    }
    if (!cur) continue            // content before the first dash — ignore
    i = assignField(cur, trimmed, lines, i, indent)
  }
  return out.map(finishScenario).filter((s) => s.name)   // a scenario with no name is malformed — drop it
}

// assign a `key: value` field to the current item. When the value is a block-scalar indicator (`|`
// literal / `>` folded), consume the following more-indented lines as the value and return the index of
// the LAST consumed line (the for-loop's ++ then moves past it); otherwise return `idx` unchanged.
function assignField(cur: Partial<Scenario>, kv: string, lines: string[], idx: number, keyIndent: number): number {
  const f = kv.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
  if (!f) return idx
  const key = f[1]
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
    setField(cur, key, fold ? body.join(' ').replace(/\s+/g, ' ').trim() : body.join('\n'))
    return j - 1
  }
  setField(cur, key, unquote(f[2]))
  return idx
}

function setField(cur: Partial<Scenario>, key: string, val: string): void {
  if (key === 'name') cur.name = val
  else if (key === 'description') cur.description = val
  else if (key === 'expected') cur.expected = val
  else if (key === 'test') cur.test = val
}
const unquote = (s: string) => s.replace(/^["'](.*)["']$/, '$1').trim()

function finishScenario(c: Partial<Scenario>): Scenario {
  return {
    name: c.name ?? '',
    description: c.description ?? '',
    expected: c.expected ?? '',
    ...(c.test ? { test: c.test } : {}),
  }
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
