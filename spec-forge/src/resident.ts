import { ForgeCache } from './cache.js'
import { githubDriver } from './drivers/github.js'
import type { NodeLinks } from './links.js'

// @@@ resident forge - a process-lifetime ForgeCache so the dashboard's /api/board can fold per-node open
// work WITHOUT a blocking `gh` call on the request path. The contract is the whole point: view() is
// ALWAYS instant (it serves the last successful reconcile), and asking for a view opportunistically kicks
// a BACKGROUND reconcile when the cache is stale. So the first board after boot has no badges and the next
// poll has them — never a request that waits on the network. This is the residency concern only; the pure
// cache + resolution stay in cache.ts/links.ts (see [[freshness]]/[[links]]). The host is the github
// driver (the one real driver today, same as the CLI); a second host would select through the port.

const cache = new ForgeCache()
let inFlight: Promise<void> | null = null
// last reconcile ATTEMPT (success or failure), so the TTL backs off BOTH — a forge-less repo (no gh, no
// repo, no auth) makes reconcile throw, and without this we'd respawn `gh` on every single board poll.
let lastAttempt = 0
const TTL_MS = 60_000

// @@@ refreshIfStale - the background half. At most one reconcile in flight; skip while one is running or
// while the last attempt is still within the TTL. A failed reconcile is SWALLOWED on purpose: that is how
// "silent when no forge" is enforced — a broken/absent `gh` leaves the cache empty (reconcile throws
// before overwriting), so view() returns [] and the board simply has no badges, never an error.
function refreshIfStale(now: number): void {
  if (inFlight || (lastAttempt && now - lastAttempt < TTL_MS)) return
  lastAttempt = now
  inFlight = cache
    .reconcile(githubDriver)
    .catch(() => {})
    .finally(() => { inFlight = null })
}

// @@@ residentForgeView - the one entrypoint buildBoard calls. Returns the resolved node → work for the
// given node ids from whatever the cache currently holds (instant), and triggers a background refresh if
// stale. Empty until the first reconcile lands, and empty forever in a forge-less repo — by design.
export function residentForgeView(nodeIds: string[]): NodeLinks[] {
  refreshIfStale(Date.now())
  return cache.view(nodeIds)
}
