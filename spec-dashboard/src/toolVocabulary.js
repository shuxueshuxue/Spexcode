// WHAT A TOOL CALL SAYS WHEN IT IS ONE LINE.
//
// A transcript's highest-volume rows are tool calls, and the reader of scrollback wants one thing from
// each: what happened, to what. So the collapsed form is a past-tense VERB plus a target — "Read
// sessions.ts", "Ran npm test" — a sentence in the flow rather than a card. The verb IS the status on the
// happy path, which is the whole status system we can honestly offer: the transcript carries no per-tool
// success, failure, or duration, so a green tick or a red badge here would be invented. Nothing is claimed
// that was not measured.
//
// An unknown tool keeps its own name rather than rendering blank. A transcript is a record of what ran, and
// a row that says nothing is worse than a row that says a name we do not have a verb for.
const VERBS = {
  Read: 'Read', NotebookRead: 'Read',
  Grep: 'Searched', Glob: 'Searched', WebSearch: 'Searched the web',
  Bash: 'Ran', BashOutput: 'Read output',
  Edit: 'Edited', MultiEdit: 'Edited', NotebookEdit: 'Edited',
  Write: 'Wrote',
  WebFetch: 'Fetched',
  Task: 'Delegated to',
  TodoWrite: 'Updated the plan',
}

// The quiet ones: reads and searches. They are the highest-volume, lowest-information events in an agent
// transcript, so consecutive runs of them collapse into one row. Membership is by NAME only. z-code
// classifies a shell call by parsing its command for read-only verbs, which is sharper — but it is also a
// guess, and a `bash` line we misread as quiet would hide a write. A name we control is a fact; a command
// we parse is an inference, and this list only holds facts.
const QUIET = new Set(['Read', 'NotebookRead', 'Grep', 'Glob', 'WebFetch', 'WebSearch'])

export const toolVerb = (name) => VERBS[name] || name || 'tool'
export const isQuietTool = (name) => QUIET.has(name)

// The target, from the call's own arguments. `input` is the raw JSON of the arguments (or a bare string),
// so this reads the field the tool actually names and shows NOTHING when it cannot — a wrong target is
// worse than no target, and a truncated blob of JSON is not a target at all.
const TARGET_KEYS = ['file_path', 'path', 'notebook_path', 'pattern', 'query', 'command', 'cmd', 'url', 'description']
export function toolTarget(input) {
  if (typeof input !== 'string' || !input) return null
  let parsed = null
  try { parsed = JSON.parse(input) } catch { return input.length <= 80 ? input : null }
  if (!parsed || typeof parsed !== 'object') return typeof parsed === 'string' ? parsed : null
  for (const key of TARGET_KEYS) {
    const value = parsed[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

// A path reads better as its basename with the directory trailing quietly behind it — the file is what the
// reader is looking for, the directory is where it happened to live.
export function splitTarget(target) {
  if (!target || !target.includes('/') || /\s/.test(target)) return { lead: target, trail: null }
  const cut = target.lastIndexOf('/')
  return { lead: target.slice(cut + 1) || target, trail: target.slice(0, cut) }
}

// HOW A RUN COLLAPSES, without claiming anything about what the calls DID.
//
// Measured against a real transcript: 39 consecutive tool calls, every one of them `Bash`. Grouping only
// the names we know to be read-only collapsed none of them, so the reader still got 39 stacked rows — the
// exact noise this was meant to remove. z-code solves it by parsing each shell command for read-only verbs
// and merging what it judges harmless, which is sharper and is also an inference: a command we misread as
// harmless would hide a write inside a folded group.
//
// So the rule infers nothing. A run collapses because it is a RUN — three or more calls in a row — and the
// label says only what is on the record: the verb when they share one, the kinds when they do not. "12
// tool uses" claims less than "Explored" and is still the thing a reader needs in order to skip it.
export const RUN_MIN = 3

// What KINDS ran, for a row whose count is already stated beside it. Naming the kinds is what lets a reader
// decide whether to open; repeating the number they just read is noise, and the first version of this row
// said "38 tool uses  38 calls" because it did exactly that.
export function runKinds(tools) {
  const counts = new Map()
  for (const tool of tools) {
    const verb = toolVerb(tool.name)
    counts.set(verb, (counts.get(verb) || 0) + 1)
  }
  const entries = [...counts.entries()]
  if (entries.length === 1) return entries[0][0].toLowerCase()
  return entries.slice(0, 3).map(([verb, n]) => `${n} ${verb.toLowerCase()}`).join(', ')
}

// Elapsed time in a shape a reader can absorb at a glance: at most two units, biggest first. This answers
// the question scrollback actually raises — how long was it in this state — which a turn count does not.
export function elapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
  return s % 60 ? `${m}m ${s % 60}s` : `${m}m`
}
