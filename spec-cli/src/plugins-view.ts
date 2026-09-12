import { loadAgentConfig, loadConfig, loadHookConfig, loadSkillConfig, loadSystemConfig } from '@spexcode/spec-core'
import { ALL_CORE_HOOKS, resolveCliProfile } from './help.js'
import type { ConfigPreset } from '@spexcode/spec-core'

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

// @@@the-switch-that-exists - every core hook's body opens by saying the startup `SPEX_PROFILE` list may
// disable it with a clean no-op, so that list IS this surface's configuration, and a board that shows the
// hooks without it shows seven things that may or may not be running. It is read, never written: the profile
// is an environment variable of the process an agent launches under, not a project setting the page owns.
export type Profile = { name: string; retains: string[]; disables: string[] }

export type PluginsView = { rows: PluginRow[]; spine: SpineSlot[]; profile: Profile }

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

function readProfile(): Profile {
  try {
    const resolved = resolveCliProfile()
    const retains = ALL_CORE_HOOKS.filter((name: string) => resolved.hooks.has(name))
    return { name: resolved.name, retains, disables: ALL_CORE_HOOKS.filter((name: string) => !resolved.hooks.has(name)) }
  } catch { return { name: 'full', retains: [...ALL_CORE_HOOKS], disables: [] } }
}

export function pluginsView(): PluginsView {
  const rows = collectRows()
  return { rows, spine: buildSpine(rows), profile: readProfile() }
}
