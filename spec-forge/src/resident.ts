import { ForgeCache } from './cache.js'
import { githubDriver } from './drivers/github.js'
import type { NodeLinks } from './links.js'

const cache = new ForgeCache()
let inFlight: Promise<void> | null = null
// track last ATTEMPT, not last success, so the TTL also backs off failures — else a forge-less repo respawns `gh` every poll
let lastAttempt = 0
const TTL_MS = 60_000

function refreshIfStale(now: number): void {
  if (inFlight || (lastAttempt && now - lastAttempt < TTL_MS)) return
  lastAttempt = now
  inFlight = cache
    .reconcile(githubDriver)
    .catch(() => {})
    .finally(() => { inFlight = null })
}

export function residentForgeView(nodeIds: string[]): NodeLinks[] {
  refreshIfStale(Date.now())
  return cache.view(nodeIds)
}
