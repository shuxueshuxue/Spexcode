import { loadSpecs, requireGitWorkspace } from '@spexcode/spec-core'
import { resolveLayout } from '@spexcode/spec-core'
import { listSessions } from './sessions.js'
import { driftIndex, historyIndex, pruneHistoryCaches, repoRoot } from '@spexcode/spec-core'
import { residentForgeRevision, residentForgeState } from '@spexcode/spec-forge/resident'
import { resolveForgeHost } from '@spexcode/spec-forge/drivers'
import { boardThreads } from './issues.js'
import { localIssueRevision } from './localIssues.js'
import { buildBoard as assembleBoard, spliceSessions as spliceBoardSessions, type BoardSnapshot } from '@spexcode/spec-core'

// The application adapter is the sole reader of runtime/forge state. graph.ts only receives this result.
export async function boardSnapshot(): Promise<BoardSnapshot> {
  const root = repoRoot()
  requireGitWorkspace(root)
  const [specs, sessions] = await Promise.all([loadSpecs(), listSessions()])
  // Session worktrees are the live-root census for immutable history caches. Reconcile before the snapshot
  // returns so closing a session releases its full index immediately rather than waiting for an LRU slot.
  pruneHistoryCaches([root, ...sessions.map((session) => session.path)])
  const layout = await resolveLayout({ activeSessionIds: sessions.map((session) => session.id) })
  const nodeIds = [...new Set([
    ...specs.map((node) => node.id),
    ...layout.worktrees.flatMap((worktree) => (worktree.ops || []).map((op: any) => op.nodeId)),
  ].filter((id): id is string => typeof id === 'string' && id.length > 0))]
  // Sample every issue-store revision BEFORE reading the stores. Sampling after would let a write that
  // landed between the read and the sample be certified as contained in this snapshot, so a reader waiting
  // for that write would be answered with a generation that predates it. Sampling before can only
  // under-claim — the cost is one extra rebuild, never a stale answer presented as current.
  const issueSource = { forge: residentForgeRevision(), local: localIssueRevision() }
  const { issues, stamp: issuesStamp } = boardThreads(
    { host: resolveForgeHost(), state: residentForgeState() },
    nodeIds,
  )
  return {
    root, specs, layout, sessions, issues, issuesStamp, issueSource,
  }
}

export const buildBoard = async () => assembleBoard(await boardSnapshot())

export const spliceSessions = async (prev: Awaited<ReturnType<typeof buildBoard>>) => {
  const sessions = await listSessions()
  return spliceBoardSessions(prev, sessions)
}
