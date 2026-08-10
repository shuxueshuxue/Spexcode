import { loadSpecs } from '@spexcode/spec-core'
import { resolveLayout } from '@spexcode/spec-core'
import { listSessions } from './sessions.js'
import { driftIndex, historyIndex, repoRoot } from '@spexcode/spec-core'
import { residentForgeRevision, residentForgeState } from '../../spec-forge/src/resident.js'
import { resolveForgeHost } from '../../spec-forge/src/drivers.js'
import { boardThreads } from './issues.js'
import { buildBoard as assembleBoard, spliceSessions as spliceBoardSessions, type BoardSnapshot } from '@spexcode/spec-core'
import { evalContext, evalTimelines } from '../../spec-eval/src/evaltab.js'
import { evalNodesAsync } from '../../spec-eval/src/scenarios.js'
import { sessionEvalProjections } from '../../spec-eval/src/sessioneval.js'

// The application adapter is the sole reader of runtime/forge state. graph.ts only receives this result.
export async function boardSnapshot(): Promise<BoardSnapshot> {
  const root = repoRoot()
  const [specs, sessions] = await Promise.all([loadSpecs(), listSessions()])
  const layout = await resolveLayout({ activeSessionIds: sessions.map((session) => session.id) })
  const nodeIds = [...new Set([
    ...specs.map((node) => node.id),
    ...layout.worktrees.flatMap((worktree) => (worktree.ops || []).map((op: any) => op.nodeId)),
  ].filter((id): id is string => typeof id === 'string' && id.length > 0))]
  const { issues, stamp: issuesStamp } = boardThreads(
    { host: resolveForgeHost(), state: residentForgeState() },
    nodeIds,
  )
  const [idx, hidx, evalNodes] = await Promise.all([driftIndex(root), historyIndex(root), evalNodesAsync(root)])
  const context = await evalContext(root, specs, idx, hidx, undefined, evalNodes)
  const timelines = await evalTimelines(nodeIds, context)
  return {
    root, specs, layout, sessions, issues, issuesStamp, forgeRevision: residentForgeRevision(),
    evalTimelines: new Map(nodeIds.map((nodeId, index) => [nodeId, timelines[index]])),
    sessionEvalProjections: sessionEvalProjections(sessions),
  }
}

export const buildBoard = async () => assembleBoard(await boardSnapshot())

export const spliceSessions = async (prev: Awaited<ReturnType<typeof buildBoard>>) => {
  const sessions = await listSessions()
  return spliceBoardSessions(prev, sessions, sessionEvalProjections(sessions))
}
