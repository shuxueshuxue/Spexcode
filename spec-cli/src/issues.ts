// @@@ issues - ONE Issue object over every store ([[issues]]). An Issue is a recorded concern bound to
// spec node(s), carrying its OWN lifecycle, living beside the graph and never as node state. WHERE it is
// stored — the local git forum ([[proposals]]) or a remote forge (spec-forge) — is a per-issue property
// (`store`), not a project mode: a project holds both at once, mixed. This module owns the core type, the
// forge→Issue translation (the ONLY place a host's node-naming conventions become `nodes[]` — platform
// differences stay at the adapter boundary), the merged read every surface consumes (CLI `spex issues`,
// GET /api/issues, the board fold), the STORE-ROUTED reply verb, and the CLI itself. Content writes are
// owned per store: local ones live in proposals.ts; a forge write goes through the driver's write verbs
// (createIssue/createComment — the driver stays the only network toucher; the tracer stays read-only).
import type { ForgeIssue, ForgePR } from '../../spec-forge/src/port.js'
import { resolveLinks } from '../../spec-forge/src/links.js'
import { loadProposals, loadOne, reply, resolve, proposalsEnabled, forumReply } from './proposals.js'
import { dispatchMentions, type DispatchOutcome } from './mentions.js'
import { envSessionId } from './layout.js'
import { loadSpecsLite } from './specs.js'

export type Reply = { by: string; at: string; body: string }
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
    // the forge comments ARE the thread — the same Reply shape a forum thread carries, so nothing
    // downstream renders two kinds of discussion.
    replies: (i.comments ?? []).map((c) => ({ by: c.author, at: c.createdAt, body: c.body })),
    evidence: [],
    url: i.url,
  }))
}

// the one merged read: local forum threads + the caller-supplied forge slice, oldest-first (the stable
// order the forum alone had). CALLERS own freshness — the server passes the resident cache's state
// (instant, background reconcile), the CLI a live pull — so the merge itself stays pure.
export function mergedIssues(forge: ForgeSlice | null, nodeIds: string[]): Issue[] {
  const remote = forge ? fromForge(forge, nodeIds) : []
  return [...loadProposals(), ...remote].sort((a, b) => a.created.localeCompare(b.created))
}

// @@@ promote - the ONE cross-store verb ([[issues]]): a local concern that outgrew the repo moves to the
// forge as one recorded action. The forge issue is composed from the thread itself — concern → title;
// body + the `Spec: <nodes>` marker (the round-trip: the existing tracer read links it straight back to
// the same nodes, no new linking code) + the evidence hashes + a provenance footer — and created through
// the driver (the only network toucher). ORDER makes failure safe: create the forge issue FIRST; only
// then close the local thread out (a reply carrying the permalink, then resolve `landed`) — an
// unreachable forge throws with the local thread untouched, and only an `open` thread promotes.
export async function promote(id: string): Promise<{ url: string; number: number; host: string }> {
  const t = loadOne(id)
  if (t.status !== 'open') throw new Error(`'${id}' is ${t.status} — only an open local issue promotes`)
  const { githubDriver } = await import('../../spec-forge/src/drivers/github.js')
  const body = [
    t.body,
    t.nodes.length ? `\nSpec: ${t.nodes.join(', ')}` : '',
    t.evidence.length ? `\nEvidence: ${t.evidence.join(', ')} (yatsu blob hashes)` : '',
    `\n---\nPromoted from the local issue \`${id}\` (opened by ${t.by} @ ${t.created}; promoted by ${envSessionId() || 'unknown'}).`,
  ].filter(Boolean).join('\n')
  const { number, url } = await githubDriver.createIssue({ title: t.concern, body })
  reply(id, `promoted to the forge: ${url}`)
  resolve(id, 'landed')
  return { url, number, host: githubDriver.host }
}

// @@@ replyIssue - ONE reply verb, store-routed ([[issues]]): store is a property of the issue, so
// replying doesn't fork by surface — a local id goes through the forum's committed write (proposals.ts,
// unchanged), a forge id (`<host>#<n>`) posts a REAL comment through the driver's createComment (the same
// seam discipline as promotion — no second network call-site). Either way the reply TEXT then dispatches
// its @-mentions (mentions.ts is store-agnostic: the mention fires on the words, and the mention IS the
// assign — no separate assign machinery). Callers own freshness: the server refreshes its resident forge
// slice after a forge write; the CLI's next read is a live pull anyway.
export async function replyIssue(
  id: string,
  body: string,
  opts: { author?: string; node?: string | null } = {},
): Promise<{ store: string; replies?: Reply[]; url?: string; outcomes: DispatchOutcome[] }> {
  const author = opts.author || envSessionId() || 'unknown'
  const forge = /^([A-Za-z0-9-]+)#(\d+)$/.exec(id)
  if (!forge) {
    const { thread, outcomes } = await forumReply(id, body, author)
    return { store: 'local', replies: thread.replies, outcomes }
  }
  const { githubDriver } = await import('../../spec-forge/src/drivers/github.js')
  if (forge[1] !== githubDriver.host) throw new Error(`unknown forge host '${forge[1]}' — this repo's driver is '${githubDriver.host}'`)
  const { url } = await githubDriver.createComment({ number: parseInt(forge[2], 10), body })
  const outcomes = await dispatchMentions(body, { threadId: id, node: opts.node ?? null, author })
  return { store: forge[1], url, outcomes }
}

// ───────────────────────── CLI ─────────────────────────
const fl = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const hasFlag = (args: string[], name: string) => args.includes(`--${name}`)

// `spex issues [--node id] [--store local|<host>] [--all] [--json]` — THE read over every store: the
// drain view a supervisor/human works from. Lists concerns as raw data with their recurrence signals
// (signers, replies); it deliberately imposes NO salience ranking — recurrence is a signal the drain
// WEIGHS by judgment, never an automatic priority order. The forge slice is a LIVE pull; an unreachable
// forge degrades loudly to local-only (one stderr note) — local reading never hostages on a network.
export async function runIssues(args: string[]): Promise<number> {
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
    const { githubDriver } = await import('../../spec-forge/src/drivers/github.js')
    const [issues, prs] = await Promise.all([githubDriver.listIssues(), githubDriver.listPRs()])
    forge = { host: githubDriver.host, state: { issues, prs } }
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
  if (!proposalsEnabled()) console.log('\n(the forum workflow is OFF — `spex propose on` to re-enable writes/nudges)')
  return 0
}
