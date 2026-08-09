import { loadSpecs } from './specs.js'
import { resolveLayout } from './layout.js'
import { listSessions } from './sessions.js'
import { repoRoot } from './git.js'
import { residentForgeRevision, residentForgeState } from '../../spec-forge/src/resident.js'
import { resolveForgeHost } from '../../spec-forge/src/drivers.js'
import { boardThreads } from './issues.js'
import { buildBoard as assembleBoard, spliceSessions as spliceBoardSessions, type BoardSnapshot } from './graph.js'

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
  return { root, specs, layout, sessions, issues, issuesStamp, forgeRevision: residentForgeRevision() }
}

export const buildBoard = async () => assembleBoard(await boardSnapshot())

export const spliceSessions = async (prev: Awaited<ReturnType<typeof buildBoard>>) =>
  spliceBoardSessions(prev, await listSessions())
