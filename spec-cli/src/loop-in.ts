import { notifyOriginator, type LoopIn } from './mentions.js'
import { replyIssue, type Issue } from './issues.js'
import { remarkOnHost } from './localIssues.js'

// @@@ ONE composer per path - the loop-in is reachable from four call sites: the CLI's `issue reply` and
// `remark add`, and the HTTP routes for each. If each composed its own chain, the same verb would report
// different candidates depending on which door it came through, and no gate we have would notice the drift.
// So the four sites call these two functions, and these two are the only places a chain is built.

// The fallback chain is deliberately the thread author. Ledger readers used to derive extra candidates;
// replies now use the same originator rule for every thread.
const threadOriginators = async (thread: Issue): Promise<(string | null)[]> => [thread.by]

// the implicit courtesy copy every reply carries: a copy down the fallback chain, delivered to the first online
// link, notification only — it resolves nothing (R3 keeps resolve a deliberate second-party act).
const loopInFor = async (thread: Issue, author: string, body: string, threadId: string) =>
  notifyOriginator(await threadOriginators(thread), author, body, { threadId, node: thread.nodes[0] || null })

/** `issue reply` for every store, with the originator loop-in composed on top. */
export async function replyIssueWithLoopIn(
  id: string,
  body: string,
  opts: { author?: string; node?: string | null; evidence?: string[] } = {},
): Promise<Awaited<ReturnType<typeof replyIssue>> & { loopIn: LoopIn | null }> {
  const r = await replyIssue(id, body, opts)
  // a forge thread's author is a host login, not a live session, so there is no reachable originator and no
  // local thread to read one from — silent by design, exactly as before.
  const loopIn = r.thread ? await loopInFor(r.thread, r.author, body, id) : null
  return { ...r, loopIn }
}

/** `remark add` on a host, with the same loop-in composed by the same code. */
export async function remarkWithLoopIn(
  host: { issue?: string; node?: string; scenario?: string },
  body: string,
  opts: { targetSha?: string; author?: string; evidence?: string[] } = {},
): Promise<Awaited<ReturnType<typeof remarkOnHost>> & { loopIn: LoopIn | null }> {
  const r = await remarkOnHost(host, body, opts)
  return { ...r, loopIn: await loopInFor(r.thread, r.author, body, r.thread.id) }
}
