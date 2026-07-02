// @@@ issues - ONE Issue object over every store ([[issues]]). An Issue is a recorded concern bound to
// spec node(s), carrying its OWN lifecycle, living beside the graph and never as node state. WHERE it is
// stored — the local git forum ([[proposals]]) or a remote forge (spec-forge) — is a per-issue property
// (`store`), not a project mode: a project holds both at once, mixed. This module owns the core type, the
// forge→Issue translation (the ONLY place a host's node-naming conventions become `nodes[]` — platform
// differences stay at the adapter boundary), the merged read every surface consumes (CLI `spex issues`,
// GET /api/issues, the board fold), and the CLI itself. Writes are NOT here: v1 writes go to the local
// store only (proposals.ts); the forge stays read-only (spec-forge's non-negotiable).
import type { ForgeIssue, ForgePR } from '../../spec-forge/src/port.js'
import { resolveLinks } from '../../spec-forge/src/links.js'
import { loadProposals, proposalsEnabled } from './proposals.js'
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
    replies: [],
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
