import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadAgentConfig, loadConfig, loadHookConfig, loadSkillConfig, loadSystemConfig, treeSlotDir } from '@spexcode/spec-core'
import type { ConfigPreset } from '@spexcode/spec-core'
import { compileManifest } from './hooks.js'

// @@@the-lifecycle-an-agent-actually-walks - the spine's order is a READING order, not data: the harness
// fires these, and this is the sequence a person meets them in over one session. It is written here rather
// than derived because no source declares a total order — `events` on a node names bindings, not a
// timeline. An event a node binds that is NOT in this list still appears (appended, flagged `offSpine`):
// the view's job is to show every binding, so an unknown event must show up loudly rather than vanish.
const LIFECYCLE = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'StopFailure']

// the five surfaces the field vocabulary allows, in the order the view reads them: what fires on an event,
// what is always on, what a human or an agent invokes. An EMPTY surface is kept — `agent` currently holds
// nothing, and a vocabulary slot nobody uses is a fact about the system worth seeing, not one to hide.
const SURFACES = ['hook', 'system', 'command', 'skill', 'agent'] as const
export type Surface = typeof SURFACES[number]

const LOADERS: Record<Surface, () => ConfigPreset[]> = {
  hook: loadHookConfig, system: loadSystemConfig, command: loadConfig, skill: loadSkillConfig, agent: loadAgentConfig,
}

export type PluginRow = {
  name: string
  title: string
  desc: string
  surfaces: Surface[]                 // a node may plug into more than one — `distill` and `merge` are both
  dir: string
  files: string[]
  kind: string
  events: string[]
  order: number
  block: boolean
}

export type SpineSlot = { event: string; offSpine: boolean; hooks: { name: string; order: number; block: boolean }[] }

export type ManifestDiff = { kind: 'extra' | 'missing'; event: string; order: number; block: boolean; script: string; trees: number }

export type LiveRollup = {
  declared: string[]                  // the compiled manifest lines the contract asks every tree to carry
  trees: number
  matching: number
  differing: number
  unmaterialized: number              // a tree with NO manifest runs NO hooks at all — no Stop gate, nothing
  diffs: ManifestDiff[]
  examples: { path: string; state: 'differs' | 'unmaterialized' }[]
}

export type PluginsView = { rows: PluginRow[]; spine: SpineSlot[]; live: LiveRollup }

// One node reaches the view once, carrying every surface it declares. Loading per surface and merging by
// name is what makes a dual-surface node legible — a folder tree can only show it in one place, which is
// exactly the thing this view exists to stop doing.
function collectRows(): PluginRow[] {
  const byName = new Map<string, PluginRow>()
  for (const surface of SURFACES) {
    for (const p of LOADERS[surface]()) {
      const row = byName.get(p.name)
      if (row) { row.surfaces.push(surface); continue }
      byName.set(p.name, {
        name: p.name, title: p.title, desc: p.desc, surfaces: [surface],
        dir: p.dir, files: p.files, kind: p.kind, events: p.events, order: p.order, block: p.block,
      })
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function buildSpine(rows: PluginRow[]): SpineSlot[] {
  const slots = new Map<string, SpineSlot>()
  for (const event of LIFECYCLE) slots.set(event, { event, offSpine: false, hooks: [] })
  for (const row of rows) {
    if (!row.surfaces.includes('hook')) continue
    for (const event of row.events) {
      let slot = slots.get(event)
      if (!slot) { slot = { event, offSpine: true, hooks: [] }; slots.set(event, slot) }
      slot.hooks.push({ name: row.name, order: row.order, block: row.block })
    }
  }
  for (const slot of slots.values()) slot.hooks.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  return [...slots.values()]
}

// @@@live-is-per-tree-not-per-project - materialization writes one manifest into EACH registered worktree's
// slot, so "is this hook running" has as many answers as the project has trees, and they drift apart
// independently: a tree materialized before a contract changed keeps running the old set until something
// materializes it again. Measured on this repository the day the view was written, 169 worktrees existed and
// 11 carried the declared manifest. That gap is invisible everywhere else, and it is the reason a row here
// reports a COUNT rather than a badge.
function rollupLive(repo: string): LiveRollup {
  const declaredText = compileManifest()
  const declared = declaredText.split('\n').filter(Boolean)
  const declaredSet = new Set(declared)
  let matching = 0, differing = 0, unmaterialized = 0
  const counts = new Map<string, ManifestDiff>()
  const examples: LiveRollup['examples'] = []
  const bump = (kind: ManifestDiff['kind'], line: string) => {
    const key = `${kind}\t${line}`
    const seen = counts.get(key)
    if (seen) { seen.trees += 1; return }
    const [event, order, block, script] = line.split('\t')
    counts.set(key, { kind, event, order: Number(order), block: block === 'true', script, trees: 1 })
  }
  let trees: string[] = []
  try {
    const out = execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' })
    trees = out.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length))
  } catch { /* not a git repo — the view still renders the declared half */ }
  for (const tree of trees) {
    let file: string
    try { file = join(treeSlotDir(tree), 'hooks-manifest') } catch { unmaterialized += 1; continue }
    if (!existsSync(file)) {
      unmaterialized += 1
      if (examples.length < 8) examples.push({ path: tree, state: 'unmaterialized' })
      continue
    }
    const live = readFileSync(file, 'utf8')
    if (live === declaredText) { matching += 1; continue }
    differing += 1
    if (examples.length < 8) examples.push({ path: tree, state: 'differs' })
    const liveSet = new Set(live.split('\n').filter(Boolean))
    for (const line of liveSet) if (!declaredSet.has(line)) bump('extra', line)
    for (const line of declaredSet) if (!liveSet.has(line)) bump('missing', line)
  }
  return {
    declared, trees: trees.length, matching, differing, unmaterialized,
    diffs: [...counts.values()].sort((a, b) => b.trees - a.trees), examples,
  }
}

export function pluginsView(repo: string): PluginsView {
  const rows = collectRows()
  return { rows, spine: buildSpine(rows), live: rollupLive(repo) }
}
