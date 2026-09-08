import type { ForgeIssue, ForgeLabel, ForgePR } from '@spexcode/spec-forge/port'
import { resolveLinks } from '@spexcode/spec-forge/links'
import { FORGE_DRIVERS, forgeDriverFor, forgeIssueStores, resolveForgeHost } from '@spexcode/spec-forge/drivers'
import { closeLocalIssue, loadLocalIssues, loadOne, postLocalIssue, reply, replyLocalIssue } from './localIssues.js'
import { dispatchNewMentions, parseMentions, type DispatchOutcome } from './mentions.js'
import { envSessionId } from '@spexcode/spec-core'
export type Reply = {
  by: string
  at: string
  body: string
  rid?: string
  targetSha?: string
  resolved?: boolean
  resolvedAt?: string
  resolvedBy?: string
}

export type Issue = {
  id: string
  store: string
  concern: string
  by: string
  status: string
  nodes: string[]
  created: string
  body: string
  replies: Reply[]
  evidence: string[]
  labels: unknown[]
  url?: string
}

// A Reply is a plain thread post `{by, at, body}` — OR, when it carries the fields below, a REMARK
// ([[remark-substrate]]): a reply that pins a RESOLVABLE concern to its host (an issue or a scenario). A
// remark is not a new record type: it is a reply with the mutable `resolved` bit, a stable `rid` (so it is
// addressable across retracts), and the `targetSha` it was authored against (the reading it judges). A
// plain reply omits them all and parses/serializes unchanged (backward compatible). `isRemark` = rid set.
export type IssueLabel = ForgeLabel

export type ForgeState = { issues: ForgeIssue[]; prs: ForgePR[] }
export type ForgeSlice = { host: string; state: ForgeState }
export type IssueStore = { id: string; label: string; kind: 'local' | 'forge'; writable: true }

export const isRemark = (r: Reply): boolean => r.rid !== undefined

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
    evidence.length ? `Evidence: ${evidence.join(', ')} (evidence content hashes)` : '',
  ].filter(Boolean).join('\n\n')
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
    created: i.createdAt,
    body: i.body,
    // the forge comments ARE the thread — the same Reply shape a local thread carries, so nothing
    // downstream renders two kinds of discussion.
    replies: (i.comments ?? []).map((c) => ({ by: c.author, at: c.createdAt, body: c.body })),
    evidence: [],
    labels: i.labels,
    url: i.url,
  }))
}

// the one merged read: local issue-store threads + the caller-supplied forge slice, ONE time line — the
// stores are the same abstraction, so they interleave by creation time, newest first (never
// store-grouped; a reader's eye lands on what just happened, whatever store holds it). CALLERS own
// freshness — the server passes the resident cache's state (instant, background reconcile), the CLI a
// live pull — so the merge itself stays pure.
export function mergedIssues(forge: ForgeSlice | null, nodeIds: string[]): Issue[] {
  return allThreads(forge, nodeIds)
}

function allThreads(forge: ForgeSlice | null, nodeIds: string[]): Issue[] {
  const remote = forge ? fromForge(forge, nodeIds) : []
  return [...loadLocalIssues(), ...remote].sort((a, b) => b.created.localeCompare(a.created))
}

export function boardThreads(forge: ForgeSlice | null, nodeIds: string[]): { issues: Issue[]; stamp: string } {
  const threads = allThreads(forge, nodeIds)
  return { issues: threads, stamp: threadStamp(threads) }
}

export function threadStamp(threads: Issue[]): string {
  return [
    threads.filter((i) => i.status === 'open').length,
    threads.length,
    threads.reduce((n, i) => n + i.replies.length, 0),
    threads.flatMap((i) => [i.created, ...i.replies.flatMap((r) => [r.at, r.resolvedAt ?? ''])]).reduce((a, b) => (b > a ? b : a), ''),
  ].join(':')
}

export async function createIssue(
  concern: string,
  opts: { store?: string; nodes?: string[]; body?: string; evidence?: string[]; author?: string } = {},
): Promise<{ store: string; id: string; nodes: string[]; url?: string; outcomes: DispatchOutcome[] }> {
  const store = opts.store || 'local'
  const author = opts.author || envSessionId() || 'unknown'
  if (store === 'local') {
    const { thread, outcomes } = await postLocalIssue(concern, {
      nodes: opts.nodes,
      body: opts.body,
      evidence: opts.evidence,
      author,
    })
    return { store: 'local', id: thread.id, nodes: thread.nodes, outcomes }
  }

  const driver = forgeDriverFor(store)
  if (!driver) throw new Error(`unknown issue store '${store}' (known: ${issueStores().map((s) => s.id).join(', ')})`)
  const nodes = inferNodes(concern, opts.body, opts.nodes)
  const { number, url } = await driver.createIssue({
    title: concern,
    body: forgeIssueBody(concern, opts.body, nodes, opts.evidence),
  })
  const id = `${driver.host}#${number}`
  return { store: driver.host, id, nodes, url, outcomes: await dispatchNewMentions(opts.body || concern, { threadId: id, node: nodes[0] || null, author, status: 'open' }) }
}

export async function promote(id: string, opts: { author?: string } = {}): Promise<{ url: string; number: number; host: string }> {
  const author = opts.author || envSessionId() || 'unknown'
  const t = loadOne(id)
  if (t.status !== 'open') throw new Error(`'${id}' is ${t.status} — only an open local issue promotes`)
  const host = resolveForgeHost()
  const driver = forgeDriverFor(host)
  if (!driver) throw new Error(`no driver for this repo's forge host '${host}' (known: ${FORGE_DRIVERS.map((d) => d.host).join(', ')}) — promotion needs one`)
  const body = [
    t.body,
    t.nodes.length ? `\nSpec: ${t.nodes.join(', ')}` : '',
    t.evidence.length ? `\nEvidence: ${t.evidence.join(', ')} (evidence content hashes)` : '',
    `\n---\nPromoted from the local issue \`${id}\` (opened by ${t.by} @ ${t.created}; promoted by ${author}).`,
  ].filter(Boolean).join('\n')
  const { number, url } = await driver.createIssue({ title: t.concern, body })
  reply(id, `promoted to the forge: ${url}`, author)
  closeLocalIssue(id)
  return { url, number, host: driver.host }
}

export async function replyIssue(
  id: string,
  body: string,
  opts: { author?: string; node?: string | null; evidence?: string[] } = {},
): Promise<{ store: string; replies?: Reply[]; url?: string; thread?: Issue; author: string; outcomes: DispatchOutcome[] }> {
  const author = opts.author || envSessionId() || 'unknown'
  const forge = /^([A-Za-z0-9-]+)#(\d+)$/.exec(id)
  if (!forge) {
    // evidence hashes accrue onto the local thread's typed evidence[] (a forge thread has no such field —
    // an annotation's frame rides its comment body's image link there, the driver the only network toucher);
    const { thread, outcomes } = await replyLocalIssue(id, body, author, opts.evidence)
    // the thread rides along so [[loop-in]] can resolve this reply's originator chain without a second read.
    return { store: 'local', replies: thread.replies, thread, author, outcomes }
  }
  const driver = forgeDriverFor(forge[1])
  if (!driver) throw new Error(`unknown forge host '${forge[1]}' — known: ${FORGE_DRIVERS.map((d) => d.host).join(', ')}`)
  const { url } = await driver.createComment({ number: parseInt(forge[2], 10), body })
  return { store: forge[1], url, author, outcomes: await dispatchNewMentions(body, { threadId: id, node: opts.node ?? null, author }) }
}

export async function closeIssue(id: string): Promise<{ store: string; status: string; url?: string }> {
  const forge = /^([A-Za-z0-9-]+)#(\d+)$/.exec(id)
  if (!forge) return { store: 'local', status: closeLocalIssue(id).status }
  const driver = forgeDriverFor(forge[1])
  if (!driver) throw new Error(`unknown forge host '${forge[1]}' — known: ${FORGE_DRIVERS.map((d) => d.host).join(', ')}`)
  const { url } = await driver.closeIssue({ number: parseInt(forge[2], 10) })
  return { store: forge[1], status: 'closed', url }
}

// ───────────────────────── CLI ─────────────────────────

export function findIssue(id: string, forge: ForgeSlice | null, nodeIds: string[]): Issue | undefined {
  return mergedIssues(id.includes('#') ? forge : null, nodeIds).find((i) => i.id === id)
}
