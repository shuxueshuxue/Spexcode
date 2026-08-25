import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { loadSpecs, requireGitWorkspace, headSha } from '@spexcode/spec-core'
import { resolveLayout } from '@spexcode/spec-core'
import { listSessions } from './sessions.js'
import { driftIndex, historyIndex, repoRoot } from '@spexcode/spec-core'
import { residentForgeRevision, residentForgeState } from '@spexcode/spec-forge/resident'
import { resolveForgeHost } from '@spexcode/spec-forge/drivers'
import { boardThreads } from './issues.js'
import { buildBoard as assembleBoard, spliceSessions as spliceBoardSessions, type BoardSnapshot } from '@spexcode/spec-core'
import { evalContext, evalTimelines } from '@spexcode/spec-eval/evaltab'
import { evalNodesAsync } from '@spexcode/spec-eval/scenarios'
import { sessionEvalProjections } from '@spexcode/spec-eval/sessioneval'
import { evalRemarkSourceFingerprint } from '@spexcode/spec-eval/host'
import { listBlobs } from '@spexcode/spec-eval/cache'

type TimelineCache = { key: string; timelines: Awaited<ReturnType<typeof evalTimelines>> }
let timelineCache: TimelineCache | null = null

function fileFingerprint(path: string): string {
  try { return readFileSync(path).toString('base64') }
  catch { return '<missing>' }
}

function timelineCacheKey(
  root: string,
  nodeIds: readonly string[],
  specs: Awaited<ReturnType<typeof loadSpecs>>,
  evalNodes: Awaited<ReturnType<typeof evalNodesAsync>>,
): string {
  const hash = createHash('sha256')
  hash.update(root)
  hash.update('\0')
  hash.update(headSha(root) || '<no-head>')
  hash.update('\0')
  hash.update(JSON.stringify(nodeIds))
  for (const spec of specs) {
    hash.update('\0spec\0')
    hash.update(spec.path)
    hash.update('\0')
    hash.update(spec.body)
  }
  for (const node of evalNodes) {
    hash.update('\0eval\0')
    hash.update(node.id)
    hash.update('\0')
    hash.update(node.evalSource ?? '')
    hash.update('\0')
    hash.update(fileFingerprint(node.sidecarPath))
  }
  // Issue remarks are an eval input even though they live outside the spec tree.
  hash.update('\0remarks\0')
  hash.update(evalRemarkSourceFingerprint())
  // Evidence presence is part of each published timeline row (`present` vs `miss`).
  hash.update('\0blobs\0')
  hash.update(listBlobs().join('\0'))
  return hash.digest('hex')
}

// The application adapter is the sole reader of runtime/forge state. graph.ts only receives this result.
export async function boardSnapshot(): Promise<BoardSnapshot> {
  const root = repoRoot()
  requireGitWorkspace(root)
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
  const key = timelineCacheKey(root, nodeIds, specs, evalNodes)
  let timelines: Awaited<ReturnType<typeof evalTimelines>>
  if (timelineCache?.key === key) {
    timelines = timelineCache.timelines
  } else {
    // The board carries only latest-per-scenario counts, so the cold build reads latest-only: the retained
    // sidecar history is served by the detail endpoints and probing it here scales graph latency with the
    // reading count instead of the live verdict population. Freshness itself is NOT deferred — the board
    // publishes verdicts, and a verdict whose freshness was never computed is not a stale verdict, it is no
    // verdict at all. An order-only board would report every measured row as stale and none as fresh.
    timelines = await evalTimelines(nodeIds, context, { latestOnly: true })
    timelineCache = { key, timelines }
  }
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
