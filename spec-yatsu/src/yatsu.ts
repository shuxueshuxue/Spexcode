import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, basename } from 'node:path'

// @@@ yatsu node model - a node declares its scenarios in a `yatsu.md` beside its `spec.md`. The
// scenarios are the targets the eval/loss engine reads; the readings they produce live in a flat
// `yatsu.evals.ndjson` sidecar in the same dir (the second git-as-database axis — see [[sidecar]]).
// A node has scenarios IFF it has a yatsu.md; the spec walk (spec-cli) is unchanged — yatsu.md is a
// sibling file it never looks at.

export const YATSU_FILE = 'yatsu.md'
export const SIDECAR_FILE = 'yatsu.evals.ndjson'

// @@@ Scenario - one declared observation: a `driver` (which producer reads it — the manual producer
// today, a computer-use "stupid user" later), a `target` (what it points at: a route, a surface, a
// description), and EITHER a `run` (path to a native test that IS the scenario body) OR inline `steps`.
// name is its key in the sidecar; the bug-fix keystone (a repro becoming a regression scenario) appends one.
export type Scenario = {
  name: string
  driver: string
  target: string
  run?: string
  steps?: string[]
}

export type YatsuNode = {
  id: string            // the node's leaf dir name (its spec-node id)
  dir: string           // absolute node directory
  yatsuPath: string     // repo-relative path to yatsu.md — the SCENARIO freshness axis
  sidecarPath: string   // absolute path to yatsu.evals.ndjson
  scenarios: Scenario[]
}

// @@@ scenarios parser - yatsu.md declares scenarios in a frontmatter `scenarios:` block: a YAML block
// sequence of mappings (name/driver/target/run, plus an optional `steps:` sub-sequence). The spec-cli
// frontmatter reader is scalar / flat-string-list only, so this is a small indentation-driven parser for
// exactly that shape — no YAML dependency, the same "deliberately tiny" spirit. Sequence items are the
// dashes at the shallowest indent after `scenarios:`; `key: value` lines deeper set the current item's
// fields; a `steps:` field opens a nested dash-sequence of strings.
export function parseScenarios(src: string): Scenario[] {
  const m = src.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return []
  const lines = m[1].split('\n')
  let i = lines.findIndex((l) => /^scenarios:\s*$/.test(l))
  if (i < 0) return []
  const out: Scenario[] = []
  let cur: Partial<Scenario> | null = null
  let itemIndent = -1            // the indent of the `- ` that starts each scenario (set by the first one)
  let inSteps = false
  const indentOf = (l: string) => l.length - l.replace(/^\s+/, '').length
  for (i++; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const indent = indentOf(line)
    if (indent === 0) break       // dedented to another top-level key — scenarios block is done
    const trimmed = line.trim()
    const dash = trimmed.startsWith('- ') || trimmed === '-'
    if (dash && (itemIndent < 0 || indent <= itemIndent)) {
      // a new scenario item. flush the previous, start fresh; the `- ` may carry the first field inline.
      if (cur) out.push(finishScenario(cur))
      itemIndent = indent
      inSteps = false
      cur = {}
      const inline = trimmed.slice(1).trim()   // text after the dash
      if (inline) assignField(cur, inline)
      continue
    }
    if (!cur) continue            // content before the first dash — ignore
    if (inSteps && dash) { (cur.steps ??= []).push(trimmed.slice(1).trim()); continue }
    // a `key: value` field on the current item.
    const f = trimmed.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!f) continue
    if (f[1] === 'steps' && !f[2]) { inSteps = true; cur.steps ??= []; continue }
    inSteps = false
    assignField(cur, trimmed)
  }
  if (cur) out.push(finishScenario(cur))
  return out.filter((s) => s.name)   // a scenario with no name is malformed — drop it
}

function assignField(cur: Partial<Scenario>, kv: string): void {
  const f = kv.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
  if (!f) return
  const key = f[1], val = unquote(f[2])
  if (key === 'name') cur.name = val
  else if (key === 'driver') cur.driver = val
  else if (key === 'target') cur.target = val
  else if (key === 'run') cur.run = val
}
const unquote = (s: string) => s.replace(/^["'](.*)["']$/, '$1').trim()

function finishScenario(c: Partial<Scenario>): Scenario {
  return {
    name: c.name ?? '',
    driver: c.driver ?? 'manual',
    target: c.target ?? '',
    ...(c.run ? { run: c.run } : {}),
    ...(c.steps && c.steps.length ? { steps: c.steps } : {}),
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
