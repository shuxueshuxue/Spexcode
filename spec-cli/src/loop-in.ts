import { deliveredIds, notifyOriginator, type LoopIn } from './mentions.js'
import { replyIssue, type Issue } from './issues.js'
import { parseEvalConcern, remarkOnHost } from './localIssues.js'

// @@@ loop-in - the originator loop-in's eval-aware half, at the one altitude that can hold it
// ([[mentions]] / [[remark-substrate]] R3). The MECHANISM never moved: `notifyOriginator`, `summarize` and
// `LoopIn` live in `mentions.ts`, genuine substrate, and they stay there. What lived at the wrong height was a
// single INPUT — resolving WHICH candidates to try, which for an eval-remark thread means asking the eval
// package who filed the reading under judgement. That resolution sat in `localIssues.ts`, a module the eval
// package imports, so it could only reach eval through a deferred `await import()` whose own comment explained
// why it had to be wrong. A correct mechanism with one mis-layered input is the hardest shape to see: every
// piece you read is where it belongs.
//
// This module sits above both the store modules and the eval layer, so the import is an ordinary static one.

// @@@ ONE composer per path - the loop-in is reachable from four call sites: the CLI's `issue reply` and
// `remark add`, and the HTTP routes for each. If each composed its own chain, the same verb would report
// different candidates depending on which door it came through, and no gate we have would notice the drift.
// So the four sites call these two functions, and these two are the only places a chain is built.

// A node's governing session — the `session` its spec resolves to (the Session: trailer of its latest version,
// else the frontmatter `session:` fallback; specs.ts owns that derivation). The fallback link when a reading's
// filer is unreachable. null when the node is unknown or has no governing session.
async function nodeGoverningSession(nodeId: string): Promise<string | null> {
  const { loadSpecs } = await import('./specs.js')
  return (await loadSpecs()).find((s) => s.id === nodeId)?.session ?? null
}

// The FALLBACK CHAIN of candidates a reply loops in (R3's dispatch clause), tried in order until one is online.
// A plain thread's only candidate is its author. An EVAL-COMMENT thread (concern `eval: <node> · <scenario>`)
// chains: the agent who FILED the reading the remark judges FIRST — resolved from the TRUNK sidecar, then from
// each LIVE session's worktree sidecar (the review-time case, when the filer sits online awaiting review) —
// then the NODE's governing session, so an unresolved remark still reaches an agent who can act on it. A
// broken/absent worktree sidecar falls through silently: one bad worktree never fails the remark write.
// Non-eval threads pay nothing — no eval, specs or sessions module is touched for them.
async function threadOriginators(thread: Issue): Promise<(string | null)[]> {
  const parsed = parseEvalConcern(thread.concern)
  if (!parsed) return [thread.by]
  const { node, scenario } = parsed
  const { evalReadingFiler } = await import('../../spec-eval/src/filing.js')
  const chain: (string | null)[] = [evalReadingFiler(node, scenario)]
  try {
    const { listSessions } = await import('./sessions.js')
    for (const s of await listSessions()) {
      try { if (s.path) chain.push(evalReadingFiler(node, scenario, s.path)) } catch { /* one unreadable worktree → next link */ }
    }
  } catch { /* sessions unavailable (bare store, no tmux) → trunk-only chain, as before */ }
  chain.push(await nodeGoverningSession(node))
  return chain
}

// the implicit courtesy copy every reply carries: a copy down the fallback chain, delivered to the first online
// link, notification only — it resolves nothing (R3 keeps resolve a deliberate second-party act).
const loopInFor = async (thread: Issue, author: string, body: string, threadId: string, outcomes: Parameters<typeof deliveredIds>[0]) =>
  notifyOriginator(await threadOriginators(thread), author, body,
    { threadId, node: thread.nodes[0] || null, alreadyDelivered: deliveredIds(outcomes) })

/** `issue reply` for every store, with the originator loop-in composed on top. */
export async function replyIssueWithLoopIn(
  id: string,
  body: string,
  opts: { author?: string; node?: string | null; evidence?: string[] } = {},
): Promise<Awaited<ReturnType<typeof replyIssue>> & { loopIn: LoopIn | null }> {
  const r = await replyIssue(id, body, opts)
  // a forge thread's author is a host login, not a live session, so there is no reachable originator and no
  // local thread to read one from — silent by design, exactly as before.
  const loopIn = r.thread ? await loopInFor(r.thread, r.author, body, id, r.outcomes) : null
  return { ...r, loopIn }
}

/** `remark add` on a host, with the same loop-in composed by the same code. */
export async function remarkWithLoopIn(
  host: { issue?: string; node?: string; scenario?: string },
  body: string,
  opts: { codeSha?: string; author?: string; evidence?: string[] } = {},
): Promise<Awaited<ReturnType<typeof remarkOnHost>> & { loopIn: LoopIn | null }> {
  const r = await remarkOnHost(host, body, opts)
  return { ...r, loopIn: await loopInFor(r.thread, r.author, body, r.thread.id, r.outcomes) }
}
