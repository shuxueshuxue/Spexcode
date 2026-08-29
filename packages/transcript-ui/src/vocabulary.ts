import type { StreamTool, TranscriptTool } from '@spexcode/transcript/frames'

export type AnyTool = TranscriptTool | StreamTool

// WHAT A TOOL CALL SAYS WHEN IT IS ONE LINE. A transcript's highest-volume rows are tool calls, and the
// reader of scrollback wants one thing from each: what happened, to what. So the collapsed form is a
// past-tense VERB plus a target — "Read sessions.ts", "Ran npm test" — a sentence in the flow rather than a
// card. The verb IS the status on the happy path, which is the whole status system the record can honestly
// offer: it carries no per-tool success, failure, or duration, so a tick or a badge here would be invented.
// An unknown tool keeps its own name rather than rendering blank.
//
// The vocabulary is DATA an adopter extends: a harness whose tools are named differently supplies its own
// verbs and target keys; nothing here is a branch on a harness id.
export type Vocabulary = Readonly<{
  verbs: Readonly<Record<string, string>>
  quiet: ReadonlySet<string>          // reads and searches — the highest-volume, lowest-information calls
  targetKeys: readonly string[]       // argument fields that name what the call acted on, first match wins
}>

export const defaultVocabulary: Vocabulary = {
  verbs: {
    Read: 'Read', NotebookRead: 'Read',
    Grep: 'Searched', Glob: 'Searched', WebSearch: 'Searched the web',
    Bash: 'Ran', BashOutput: 'Read output',
    Edit: 'Edited', MultiEdit: 'Edited', NotebookEdit: 'Edited',
    Write: 'Wrote',
    WebFetch: 'Fetched',
    Task: 'Delegated to',
    TodoWrite: 'Updated the plan',
  },
  quiet: new Set(['Read', 'NotebookRead', 'Grep', 'Glob', 'WebFetch', 'WebSearch']),
  targetKeys: ['file_path', 'filePath', 'path', 'notebook_path', 'pattern', 'query', 'command', 'cmd', 'url', 'description'],
}

export function extendVocabulary(base: Vocabulary, extra: Partial<{ verbs: Record<string, string>; quiet: Iterable<string>; targetKeys: readonly string[] }>): Vocabulary {
  return {
    verbs: { ...base.verbs, ...(extra.verbs ?? {}) },
    quiet: new Set([...base.quiet, ...(extra.quiet ?? [])]),
    targetKeys: extra.targetKeys ? [...extra.targetKeys, ...base.targetKeys.filter((key) => !extra.targetKeys!.includes(key))] : base.targetKeys,
  }
}

// AN MCP TOOL IS NAMED BY ITS SERVER AND ITS TOOL. Every harness that speaks MCP writes the call as
// `mcp__<server>__<tool>`; the reader wants both halves, apart — measured across four transcript renderers,
// three knew the server in their data and lost it on the screen. The vocabulary may name the full id or the
// bare tool; an unnamed MCP tool reads as its tool half, never the whole mangled id.
export function toolName(name: string | undefined): { tool: string; server: string | null } {
  const m = name ? /^mcp__(.+?)__(.+)$/.exec(name) : null
  return m ? { tool: m[2], server: m[1] } : { tool: name || 'tool', server: null }
}
export const toolVerb = (name: string | undefined, vocabulary = defaultVocabulary): string => {
  if (name && vocabulary.verbs[name]) return vocabulary.verbs[name]
  const { tool } = toolName(name)
  return vocabulary.verbs[tool] || tool
}

// THE ARGUMENTS, WHEN OPENED, READ AS THE ARGUMENTS: a JSON object pretty-printed one field per line, a bare
// string (a script, a command) as itself. The wire form is one line; nobody reads one line of JSON.
export function prettyInput(input: string | undefined): string {
  if (typeof input !== 'string' || !input) return ''
  try {
    const parsed: unknown = JSON.parse(input)
    return parsed && typeof parsed === 'object' ? JSON.stringify(parsed, null, 2) : input
  } catch { return input }
}
export const isQuietTool = (name: string, vocabulary = defaultVocabulary): boolean => vocabulary.quiet.has(name)

// The target, from the call's own arguments. `input` is the raw JSON of the arguments (or a bare string), so
// this reads the field the tool actually names and shows NOTHING when it cannot — a wrong target is worse
// than no target, and a truncated blob of JSON is not a target at all.
export function toolTarget(input: string | undefined, vocabulary = defaultVocabulary): string | null {
  if (typeof input !== 'string' || !input) return null
  let parsed: unknown = null
  try { parsed = JSON.parse(input) } catch { return input.length <= 80 ? input : null }
  if (!parsed || typeof parsed !== 'object') return typeof parsed === 'string' ? parsed : null
  for (const key of vocabulary.targetKeys) {
    const value = (parsed as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

// A path reads better as its basename with the directory trailing quietly behind it.
export function splitTarget(target: string | null): { lead: string | null; trail: string | null } {
  if (!target || !target.includes('/') || /\s/.test(target)) return { lead: target, trail: null }
  const cut = target.lastIndexOf('/')
  return { lead: target.slice(cut + 1) || target, trail: target.slice(0, cut) }
}

// HOW A RUN COLLAPSES, without claiming anything about what the calls DID. Measured against a real
// transcript: 39 consecutive calls, every one of them `Bash`; grouping only the names known to be read-only
// collapsed none of them. So the rule infers nothing: a run collapses because it is a RUN — `runMin` or more
// calls in a row — and the label says only what is on the record.
export const RUN_MIN = 3

// What KINDS ran, for a row whose count is already stated beside it: the verb when they share one, the kinds
// when they do not — never the number again.
export function runKinds(tools: readonly AnyTool[], vocabulary = defaultVocabulary): string {
  const counts = new Map<string, number>()
  for (const tool of tools) {
    const verb = toolVerb(tool.name, vocabulary)
    counts.set(verb, (counts.get(verb) || 0) + 1)
  }
  const entries = [...counts.entries()]
  if (entries.length === 1) return entries[0][0].toLowerCase()
  return entries.slice(0, 3).map(([verb, n]) => `${n} ${verb.toLowerCase()}`).join(', ')
}

// Elapsed time in a shape a reader can absorb at a glance: at most two units, biggest first.
export function elapsed(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
  return s % 60 ? `${m}m ${s % 60}s` : `${m}m`
}

export const timeOf = (ts: number | string): string => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
