// @@@ issues - ONE Issue object over every store ([[issues]]). An Issue is a recorded concern bound to
// spec node(s), carrying its OWN lifecycle, living beside the graph and never as node state. WHERE it is
// stored — the local git store ([[local-issues]]) or a remote forge (spec-forge) — is a per-issue property
// (`store`), not a project mode: a project holds both at once, mixed. This module owns the core type, the
// forge→Issue translation (the ONLY place a host's node-naming conventions become `nodes[]` — platform
// differences stay at the adapter boundary), the merged read every surface consumes (CLI `spex issues`,
// GET /api/issues, the board fold), the STORE-ROUTED reply/close verbs, and the CLI itself. Content writes are
// owned per store: local ones live in localIssues.ts; a forge write goes through the driver's write verbs
// (createIssue/createComment/closeIssue — the driver stays the only network toucher; the tracer stays read-only).
import type { ForgeIssue, ForgePR } from '../../spec-forge/src/port.js'
import { resolveLinks } from '../../spec-forge/src/links.js'
import { DEFAULT_FORGE_HOST, FORGE_DRIVERS, forgeDriverFor, forgeIssueStores } from '../../spec-forge/src/drivers.js'
import { loadLocalIssues, loadOne, postLocalIssue, reply, resolve, issuesEnabled, replyLocalIssue, runIssueWrite, ISSUE_WRITE_SUBS } from './localIssues.js'
import { dispatchMentions, parseMentions, type DispatchOutcome, type LoopIn } from './mentions.js'
import { envSessionId } from './layout.js'
import { loadSpecsLite } from './specs.js'

// A Reply is a plain thread post `{by, at, body}` — OR, when it carries the fields below, a REMARK
// ([[remark-substrate]]): a reply that pins a RESOLVABLE concern to its host (an issue or a scenario). A
// remark is not a new record type: it is a reply with the mutable `resolved` bit, a stable `rid` (so it is
// addressable across retracts), and the `targetCodeSha` it was authored against (the reading it judges). A
// plain reply omits them all and parses/serializes unchanged (backward compatible). `isRemark` = rid set.
export type Reply = {
  by: string
  at: string
  body: string
  rid?: string            // stable per-remark id; a reply is a remark iff this is set. Ref: `<thread-id>#<rid>`
  targetCodeSha?: string  // the reading/codeSha the remark was authored against (worktree HEAD by default)
  resolved?: boolean      // the ONE mutable teeth bit — false at author, true after a deliberate `spex resolve`
  resolvedAt?: string
  resolvedBy?: string
}
export const isRemark = (r: Reply): boolean => r.rid !== undefined
export type Issue = {
  id: string
  store: string      // 'local' | a forge host ('github') — the adapter that holds it
  concern: string
  by: string
  status: string     // its own lifecycle: local open|accepted|rejected|landed; forge open|closed
  nodes: string[]
  signers: string[]
  created: string
  body: string
  replies: Reply[]
  evidence: string[] // yatsu content-addressed blob hashes — the typed cross-node finding reference
  url?: string       // a forge permalink; a local issue has none
}

export type ForgeState = { issues: ForgeIssue[]; prs: ForgePR[] }
export type ForgeSlice = { host: string; state: ForgeState }
export type IssueStore = { id: string; label: string; kind: 'local' | 'forge'; writable: true }

export function issueStores(): IssueStore[] {
  return [
    { id: 'local', label: 'local', kind: 'local', writable: true },
    ...forgeIssueStores().map((s) => ({ ...s, writable: true as const })),
  ]
}

function inferNodes(concern: string, body: string | undefined, explicit: string[] = []): string[] {
  return [...new Set([...explicit, ...parseMentions(`${concern}\n${body || ''}`).nodes])]
}

function forgeIssueBody(concern: string, body: string | undefined, nodes: string[], evidence: string[] = []): string {
  return [
    (body || `(no detail given — ${concern})`).trim(),
    nodes.length ? `Spec: ${nodes.join(', ')}` : '',
    evidence.length ? `Evidence: ${evidence.join(', ')} (yatsu blob hashes)` : '',
  ].filter(Boolean).join('\n\n')
}

// ── the (node, scenario) ↔ eval-thread join ([[remark-teeth]]) ────────────────────────────────────────
// A scenario's remark track lives ONCE in trunk, keyed by its `eval: <node> · <scenario>` concern thread
// (R4). This is the ONE server-side overlay: the same join the dashboard's Annotator used to compute
// client-side (concern-key matching), lifted here so the CLI, the board fold, the session proof, and the
// annotator all read ONE join. It returns, per pair, the thread plus its REMARK replies (the resolvable
// ones — a plain comment on the thread is not a remark). The teeth ([[remark-teeth]]) read the remark
// signals; the annotator reads the thread.
export type RemarkTrack = { threadId: string; node: string; scenario: string; thread: Issue; remarks: Reply[] }

// `eval: <node> · <scenario>` — node first (never contains ' · '), then the scenario (may). One thread per
// pair (EventDetail.jsx evalConcern / localIssues.ts resolveRemarkHost mint it), so the last write wins is fine.
const EVAL_CONCERN_RE = /^eval: (.+?) · (.+)$/
export const trackKey = (node: string, scenario: string): string => `${node} · ${scenario}`

// an eval-remark thread is the eval scoreboard's data, NOT a drain-worthy issue (I1: a scenario-scoped
// concern is a remark, never an issue). Its `eval: <node> · <scenario>` concern is the tell — the SAME key
// loadEvalRemarkTracks isolates them by. The two reads are complementary over one store: mergedIssues (the
// ISSUE surfaces) excludes these; loadEvalRemarkTracks (the EVAL surfaces) keeps only these.
export const isEvalConcern = (concern: string): boolean => EVAL_CONCERN_RE.test(concern)

// read the whole local store ONCE and split the eval-concern threads out (directive 3): trunk-scoped,
// read-time, no branch write. A remark whose scenario no longer exists still LOADS here (it just keys a pair
// no reading joins) — never a crash, per [[remark-teeth]]'s dangling clause.
export function loadEvalRemarkTracks(): Map<string, RemarkTrack> {
  const out = new Map<string, RemarkTrack>()
  for (const t of loadLocalIssues()) {
    const m = EVAL_CONCERN_RE.exec(t.concern)
    if (!m) continue
    const node = m[1].trim(), scenario = m[2].trim()
    out.set(trackKey(node, scenario), { threadId: t.id, node, scenario, thread: t, remarks: t.replies.filter(isRemark) })
  }
  return out
}

// forge → Issue, at the adapter boundary: the host's node-naming conventions (`Spec:` body marker +
// transitive PR links — spec-forge links.ts) become plain `nodes[]` HERE, validated against the real node
// ids, so nothing downstream ever knows a marker existed. Every raw issue maps — linked or not — because
// the merged list is the whole set, not just the per-node view.
export function fromForge(slice: ForgeSlice, nodeIds: string[]): Issue[] {
  const nodesByNumber = new Map<number, string[]>()
  for (const link of resolveLinks(slice.state.issues, slice.state.prs, nodeIds))
    for (const i of link.issues) {
      const arr = nodesByNumber.get(i.number) ?? []
      arr.push(link.node)
      nodesByNumber.set(i.number, arr)
    }
  return slice.state.issues.map((i) => ({
    id: `${slice.host}#${i.number}`,
    store: slice.host,
    concern: i.title,
    by: i.author,
    status: (i.state || '').toLowerCase(),
    nodes: nodesByNumber.get(i.number) ?? [],
    signers: [],
    created: i.createdAt,
    body: i.body,
    // the forge comments ARE the thread — the same Reply shape a local thread carries, so nothing
    // downstream renders two kinds of discussion.
    replies: (i.comments ?? []).map((c) => ({ by: c.author, at: c.createdAt, body: c.body })),
    evidence: [],
    url: i.url,
  }))
}

// the one merged read: local issue-store threads + the caller-supplied forge slice, ONE time line — the
// stores are the same abstraction, so they interleave by creation time, newest first (never
// store-grouped; a reader's eye lands on what just happened, whatever store holds it). CALLERS own
// freshness — the server passes the resident cache's state (instant, background reconcile), the CLI a
// live pull — so the merge itself stays pure. Eval-remark threads are SPLIT OUT read-time (isEvalConcern):
// they are the eval scoreboard's data, not issues, so every issue surface this feeds — the Threads tab, the
// board issue badge, the `spex issues` drain — is free of them by construction (they reach the EVAL side
// through loadEvalRemarkTracks / the reading overlay instead).
export function mergedIssues(forge: ForgeSlice | null, nodeIds: string[]): Issue[] {
  const remote = forge ? fromForge(forge, nodeIds) : []
  return [...loadLocalIssues(), ...remote]
    .filter((i) => !isEvalConcern(i.concern))
    .sort((a, b) => b.created.localeCompare(a.created))
}

export async function createIssue(
  concern: string,
  opts: { store?: string; nodes?: string[]; body?: string; evidence?: string[]; author?: string } = {},
): Promise<{ store: string; id: string; url?: string; outcomes: DispatchOutcome[] }> {
  const store = opts.store || 'local'
  const author = opts.author || envSessionId() || 'unknown'
  if (store === 'local') {
    const { thread, outcomes } = await postLocalIssue(concern, {
      nodes: opts.nodes,
      body: opts.body,
      evidence: opts.evidence,
      author,
    })
    return { store: 'local', id: thread.id, outcomes }
  }

  const driver = forgeDriverFor(store)
  if (!driver) throw new Error(`unknown issue store '${store}' (known: ${issueStores().map((s) => s.id).join(', ')})`)
  const nodes = inferNodes(concern, opts.body, opts.nodes)
  const { number, url } = await driver.createIssue({
    title: concern,
    body: forgeIssueBody(concern, opts.body, nodes, opts.evidence),
  })
  const id = `${driver.host}#${number}`
  const outcomes = await dispatchMentions(opts.body || concern, { threadId: id, node: nodes[0] || null, author, status: 'open' })
  return { store: driver.host, id, url, outcomes }
}

// @@@ promote - the ONE cross-store verb ([[issues]]): a local concern that outgrew the repo moves to the
// forge as one recorded action. The forge issue is composed from the thread itself — concern → title;
// body + the `Spec: <nodes>` marker (the round-trip: the existing tracer read links it straight back to
// the same nodes, no new linking code) + the evidence hashes + a provenance footer — and created through
// the driver (the only network toucher). ORDER makes failure safe: create the forge issue FIRST; only
// then close the local thread out (a reply carrying the permalink, then resolve `landed`) — an
// unreachable forge throws with the local thread untouched, and only an `open` thread promotes.
// `author` mirrors the other write verbs: the effective session id by default, `'human'` from the dashboard.
export async function promote(id: string, opts: { author?: string } = {}): Promise<{ url: string; number: number; host: string }> {
  const author = opts.author || envSessionId() || 'unknown'
  const t = loadOne(id)
  if (t.status !== 'open') throw new Error(`'${id}' is ${t.status} — only an open local issue promotes`)
  const driver = forgeDriverFor(DEFAULT_FORGE_HOST)
  if (!driver) throw new Error(`unknown default forge host '${DEFAULT_FORGE_HOST}'`)
  const body = [
    t.body,
    t.nodes.length ? `\nSpec: ${t.nodes.join(', ')}` : '',
    t.evidence.length ? `\nEvidence: ${t.evidence.join(', ')} (yatsu blob hashes)` : '',
    `\n---\nPromoted from the local issue \`${id}\` (opened by ${t.by} @ ${t.created}; promoted by ${author}).`,
  ].filter(Boolean).join('\n')
  const { number, url } = await driver.createIssue({ title: t.concern, body })
  reply(id, `promoted to the forge: ${url}`, author)
  resolve(id, 'landed')
  return { url, number, host: driver.host }
}

// @@@ replyIssue - ONE reply verb, store-routed ([[issues]]): store is a property of the issue, so
// replying doesn't fork by surface — a local id goes through the store's committed write (localIssues.ts,
// unchanged), a forge id (`<host>#<n>`) posts a REAL comment through the driver's createComment (the same
// seam discipline as promotion — no second network call-site). Either way the reply TEXT then dispatches
// its @-mentions (mentions.ts is store-agnostic: the mention fires on the words, and the mention IS the
// assign — no separate assign machinery). Callers own freshness: the server refreshes its resident forge
// slice after a forge write; the CLI's next read is a live pull anyway.
export async function replyIssue(
  id: string,
  body: string,
  opts: { author?: string; node?: string | null; evidence?: string[] } = {},
): Promise<{ store: string; replies?: Reply[]; url?: string; outcomes: DispatchOutcome[]; loopIn: LoopIn | null }> {
  const author = opts.author || envSessionId() || 'unknown'
  const forge = /^([A-Za-z0-9-]+)#(\d+)$/.exec(id)
  if (!forge) {
    // evidence hashes accrue onto the local thread's typed evidence[] (a forge thread has no such field —
    // an annotation's frame rides its comment body's image link there, the driver the only network toucher);
    // replyLocalIssue also loops in the thread's originator ([[mentions]]) after the @-dispatch.
    const { thread, outcomes, loopIn } = await replyLocalIssue(id, body, author, opts.evidence)
    return { store: 'local', replies: thread.replies, outcomes, loopIn }
  }
  const driver = forgeDriverFor(forge[1])
  if (!driver) throw new Error(`unknown forge host '${forge[1]}' — known: ${FORGE_DRIVERS.map((d) => d.host).join(', ')}`)
  const { url } = await driver.createComment({ number: parseInt(forge[2], 10), body })
  const outcomes = await dispatchMentions(body, { threadId: id, node: opts.node ?? null, author })
  // a forge issue's author is a github login, not a live session → no reachable originator to loop in (silent).
  return { store: forge[1], url, outcomes, loopIn: null }
}

// @@@ closeIssue - ONE lifecycle close over every store ([[issues]]): the issue owns its status, so the
// dashboard Close button routes by id and never writes node state. Local closes resolve the local thread
// `landed`; forge closes call the driver's close verb and let the forced read-back reveal the closed state.
export async function closeIssue(id: string): Promise<{ store: string; status: string; url?: string }> {
  const forge = /^([A-Za-z0-9-]+)#(\d+)$/.exec(id)
  if (!forge) return { store: 'local', status: resolve(id, 'landed').as }   // resolve() returns {as, already} since the idempotent-write change; status stays the plain string
  const driver = forgeDriverFor(forge[1])
  if (!driver) throw new Error(`unknown forge host '${forge[1]}' — known: ${FORGE_DRIVERS.map((d) => d.host).join(', ')}`)
  const { url } = await driver.closeIssue({ number: parseInt(forge[2], 10) })
  return { store: forge[1], status: 'closed', url }
}

// ───────────────────────── CLI ─────────────────────────
const fl = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const hasFlag = (args: string[], name: string) => args.includes(`--${name}`)

// `spex issues …` — the ONE issues surface. Bare (with filters) it is THE read over every store: the
// drain view a supervisor/human works from, `[--node id] [--store local|<host>] [--all] [--json]`. A write
// first-positional (open|reply|sign|resolve|on|off|status|nudge — localIssues.ts) routes to the store's
// write verbs; `promote` is the one cross-store verb. The list imposes NO salience ranking — recurrence
// (signers, replies) is a signal the drain WEIGHS by judgment, never an automatic priority order. The forge
// slice is a LIVE pull; an unreachable forge degrades loudly to local-only (one stderr note) — local
// reading never hostages on a network.
export async function runIssues(args: string[]): Promise<number> {
  if (ISSUE_WRITE_SUBS.has(args[0])) return runIssueWrite(args)
  if (args[0] === 'promote') {
    const id = args[1]
    if (!id || id.startsWith('--')) { console.error('usage: spex issues promote <local-issue-id>'); return 2 }
    try {
      const r = await promote(id)
      console.log(`promoted '${id}' → ${r.host}#${r.number}  ${r.url}\n  local thread resolved landed (permalink recorded in its reply trail)`)
      return 0
    } catch (e) {
      console.error(`spex issues promote: ${e instanceof Error ? e.message : e}`)
      return 1
    }
  }
  const nodeIds = loadSpecsLite().map((s) => s.id)
  let forge: ForgeSlice | null = null
  try {
    const driver = forgeDriverFor(DEFAULT_FORGE_HOST)
    if (!driver) throw new Error(`unknown default forge host '${DEFAULT_FORGE_HOST}'`)
    const [issues, prs] = await Promise.all([driver.listIssues(), driver.listPRs()])
    forge = { host: driver.host, state: { issues, prs } }
  } catch (e) {
    console.error(`spex issues: forge unreachable — listing local only (${e instanceof Error ? e.message.split('\n')[0] : e})`)
  }
  let issues = mergedIssues(forge, nodeIds)
  const node = fl(args, 'node')
  const store = fl(args, 'store')
  if (node) issues = issues.filter((p) => p.nodes.includes(node))
  if (store) issues = issues.filter((p) => p.store === store)
  if (!hasFlag(args, 'all')) issues = issues.filter((p) => p.status === 'open')
  if (hasFlag(args, 'json')) { console.log(JSON.stringify(issues, null, 2)); return 0 }
  if (!issues.length) { console.log(node ? `no issues for node '${node}'` : 'no open issues'); return 0 }
  console.log(`issues — ${issues.length} ${hasFlag(args, 'all') ? 'total' : 'open'}${store ? ` in '${store}'` : ''}${node ? ` for '${node}'` : ''}\n`)
  for (const p of issues) {
    const tags = [p.store, p.status !== 'open' ? `[${p.status}]` : '', p.nodes.length ? `re: ${p.nodes.join(', ')}` : '', p.by ? `by ${p.by}` : ''].filter(Boolean).join('  ·  ')
    console.log(`• ${p.concern}  [${p.id}]`)
    console.log(`    ${tags}`)
    if (p.signers.length) console.log(`    +${p.signers.length} signed: ${p.signers.join(', ')}`)
    if (p.replies.length) console.log(`    ${p.replies.length} reply(ies) in thread`)
    if (p.url) console.log(`    ${p.url}`)
  }
  if (!issuesEnabled()) console.log('\n(the issues workflow is OFF — `spex issues on` to re-enable writes/nudges)')
  return 0
}
