import { ForgeCache } from './cache.js'
import { forgeDriverFor, resolveForgeHost } from './drivers.js'
import type { ForgeIssue, ForgePR } from './port.js'

const cache = new ForgeCache()
let inFlight: Promise<void> | null = null
let lastAttempt = 0
const TTL_MS = 20_000
let lastIssueSync: string | null = null
let lastFull = 0
let lastFailure: string | null = null
const FULL_MS = 30 * 60_000

function refreshIfStale(now: number): void {
  if (inFlight || (lastAttempt && now - lastAttempt < TTL_MS)) return
  const driver = forgeDriverFor(resolveForgeHost())
  if (!driver) return
  lastAttempt = now
  const startISO = new Date(now).toISOString()   // stamped at fetch START so an update during the fetch lands in the next window
  const incremental = lastIssueSync && driver.listIssuesSince && now - lastFull < FULL_MS
  inFlight = (incremental
    ? Promise.all([
        driver.listIssuesSince!(lastIssueSync!).then((delta) => cache.applyIssues(delta)),
        driver.listPRs().then((prs) => cache.setPRs(prs)),
      ]).then(() => { lastIssueSync = startISO })
    : cache.reconcile(driver).then(() => { lastFull = now; lastIssueSync = startISO })
  )
    .then(() => { lastFailure = null })
    // @@@ absorbed, never silent - this promise is SHARED: `refreshForgeNow` awaits it and every reader holds
    // it through `inFlight`, so rejecting here would surface as an unhandled rejection in callers that only
    // asked for cached state. The failure is therefore absorbed — but reporting it is not optional, because a
    // silent absorb is what makes a forge that has been down for an hour look like a forge with no issues.
    // Repeats are collapsed: the refresh retries every TTL, so an unchanged message is noise; a NEW message,
    // or the same one after a success, is a fresh fact and prints again.
    .catch((error) => {
      const message = (error as Error).message
      if (message !== lastFailure) console.error(`[forge] resident refresh failed: ${message}`)
      lastFailure = message
    })
    .finally(() => { inFlight = null })
}

export function residentForgeState(): { issues: ForgeIssue[]; prs: ForgePR[] } {
  refreshIfStale(Date.now())
  return cache.state()
}

export function residentForgeRevision(): number {
  return cache.stateRevision()
}

export async function refreshForgeNow(): Promise<void> {
  if (inFlight) await inFlight
  lastAttempt = 0
  lastFull = 0
  refreshIfStale(Date.now())
  if (inFlight) await inFlight
}
