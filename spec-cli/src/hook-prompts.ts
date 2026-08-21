export const HOOK_PROMPT_SOURCE = 'spec-cli/src/hook-prompts.ts' as const

export type HookPromptRole = 'prompt' | 'signal'
export type HookPromptParams = Readonly<Record<string, string | number>>

export type HookPromptEntry = Readonly<{
  name: string
  title: string
  description: string
  role: HookPromptRole
  content: string
}>

type HookPromptDefinition = HookPromptEntry & Readonly<{
  render: (params: HookPromptParams) => string
}>

function interpolate(template: string, params: HookPromptParams): string {
  return template.replace(/\{([a-z][a-z0-9-]*)\}/gi, (whole, key: string) => {
    const value = params[key]
    if (value === undefined) throw new Error(`hook prompt requires '${key}'`)
    return String(value)
  })
}

const SPEC_FIRST = [
  'Before accessing governed source {path}, read its governing spec FIRST: {owner}. Read the relevant NEIGHBORS too: the parent that scopes it, the siblings it borders, and the children that refine it. Then reconcile deliberately: change the spec if the intent is changing, or make the code honor it. The one forbidden move is code that silently diverges from its spec. (Fires once per session, at the first governed code read.)',
].join('\n')

const SPEC_OF_FILE = 'Contract context for this edit:\n{details}'

const STOP_GATE_VARIANTS = Object.freeze({
  full: [
    'Your session state is a CLAIM the graph, your supervisor, and other agents act on — not a box to tick to end the turn. Stopping undeclared makes your outcome a guess. Pick the ONE that is TRUE right now and run `{cli} session <choice>`, choosing the <choice> whose condition holds:',
    '  • done --propose merge  — spec+code COMMITTED on the branch and genuinely ready for human review. It automatically runs the configured candidate-vs-main acceptance gate, declares REVIEW, and is the ONLY proposal that offers a clickable merge.',
    '  • done --propose nothing — TRAP: records no state. Choose merge, close, ask, or park below.',
    '  • done --propose close — task genuinely settled, work landed (or none to merge), worktree no longer needed, and no human decision, follow-up, or posted artifact awaits inspection: propose human close. It declares CLOSE-PENDING, not merge. Never run `session close` on your own id.',
    '  • ask --note <what-you-await> — a human reply, direction, or decision is needed, including a reported finding/recommendation, handoff, or posted-artifact inspection. It declares ASKING and resumes only when they reply.',
    '  • park --note <what-you-await> — ONLY when a real wake-up will resume a named next action: a managed watch delivery or background task. A watch on terminal children is not a wake-up. It declares PARKED and self-resumes.',
    '',
    'DECLARE LAST, THEN STOP: finish everything else in the turn first — speak, send your messages, establish managed watches or arm background waits — and make the declaration your FINAL call. Any tool call AFTER it flips your record back to active (mark-active, by design: activity is activity), so the next stop re-blocks and demands a fresh declaration; declaring last kills that loop at its source.',
    '',
    '(This full explanation shows once per session; later undeclared stops get a one-line reminder. `{cli} help session` re-explains the choices any time.)',
  ].join('\n'),
  terse: 'undeclared stop — declare the ONE true state as your LAST call: `{cli} session <done --propose merge (review; ONLY clickable merge)|close (close-pending; settled, no human decision/follow-up or posted artifact waiting)|park (parked; real wake-up + next action) / ask (asking; human reply/direction/decision, including reported finding/recommendation or handoff)>`. `done --propose nothing` is a trap: it writes no state and names these choices. Conditions: `{cli} help session`.',
  artifact: 'a posted file/web artifact still needs human inspection; declare `spex session ask --note ...`, and declare it last.',
  commit: 'Not ready to declare done: {reason}. The dogfood ritual lands every change as a git commit on your node branch BEFORE you propose. Commit your spec.md + code on this node branch (spec: <id> — <reason>, with a Session: trailer), then re-run `{cli} session done --propose {proposal}`.',
  eval: 'eval — the loss signal the optimizer reads — flags {count} gap(s) in nodes you changed: {ids}. A node whose score went stale/unmeasured: re-measure it — PRODUCE the measurement YOURSELF with a real run of the scenario\'s actual surface (its tag on the `spex eval lint --changed` line tells you WHICH surface to run), compare to expected, and file it with `spex eval add <node>`; don\'t desk-check it, and don\'t defer to reviewing a recording after the fact. A FRONTEND node with no eval.md: give it one (a scenario — description + expected), since an obvious UI change should carry a loss signal. `spex eval lint --changed` lists them. (Advisory — fires once, not a gate.)',
})

const STOP_GATE_CONTENT = Object.entries(STOP_GATE_VARIANTS)
  .map(([name, template]) => `## ${name}\n${template}`)
  .join('\n\n')

const NO_PROMPT = (name: string, effect: string) => `No prompt text is injected by ${name}. ${effect}`

const DEFINITIONS: readonly HookPromptDefinition[] = Object.freeze([
  {
    name: 'idle',
    title: 'idle',
    description: 'Lifecycle signal only; no agent-facing text is emitted.',
    role: 'signal',
    content: NO_PROMPT('idle', 'It records an undeclared idle session in the session list.'),
    render: () => '',
  },
  {
    name: 'mark-active',
    title: 'mark-active',
    description: 'Freshness signal only; no agent-facing text is emitted.',
    role: 'signal',
    content: NO_PROMPT('mark-active', 'It updates the session lifecycle record before the tool runs.'),
    render: () => '',
  },
  {
    name: 'session-fail',
    title: 'session-fail',
    description: 'Failure signal only; no agent-facing text is emitted.',
    role: 'signal',
    content: NO_PROMPT('session-fail', 'It records a failed governed turn as error.'),
    render: () => '',
  },
  {
    name: 'spec-first',
    title: 'spec-first',
    description: 'Blocking prompt injected once before the first governed code read.',
    role: 'prompt',
    content: SPEC_FIRST,
    render: (params) => interpolate(SPEC_FIRST, params),
  },
  {
    name: 'spec-of-file',
    title: 'spec-of-file',
    description: 'Non-blocking context injected when an actionable edited file needs attention.',
    role: 'prompt',
    content: SPEC_OF_FILE,
    render: (params) => interpolate(SPEC_OF_FILE, params),
  },
  {
    name: 'stop-gate',
    title: 'stop-gate',
    description: 'Blocking and advisory prompt variants emitted at the stop boundary.',
    role: 'prompt',
    content: STOP_GATE_CONTENT,
    render: (params) => {
      const variant = String(params.variant ?? '')
      const template = STOP_GATE_VARIANTS[variant as keyof typeof STOP_GATE_VARIANTS]
      if (!template) throw new Error(`unknown stop-gate prompt variant '${variant}'`)
      return interpolate(template, params)
    },
  },
])

function freeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
  return Object.freeze(value)
}

/** The single authoring registry for text emitted by runtime hooks and published prompt catalogs. */
export class HookPromptCatalog {
  readonly entries: readonly HookPromptEntry[]
  private readonly definitions: ReadonlyMap<string, HookPromptDefinition>

  constructor() {
    this.entries = freeze(DEFINITIONS.map(({ render: _render, ...entry }) => ({ ...entry })))
    this.definitions = new Map(DEFINITIONS.map((entry) => [entry.name, entry]))
  }

  entry(name: string): HookPromptEntry {
    const entry = this.definitions.get(name)
    if (!entry) throw new Error(`surface:hook node '${name}' has no HookPromptCatalog entry`)
    const { render: _render, ...publicEntry } = entry
    return publicEntry
  }

  render(name: string, params: HookPromptParams = {}): string {
    const entry = this.definitions.get(name)
    if (!entry) throw new Error(`surface:hook node '${name}' has no HookPromptCatalog entry`)
    if (entry.role !== 'prompt') throw new Error(`surface:hook node '${name}' does not emit prompt text`)
    return entry.render(params)
  }
}
