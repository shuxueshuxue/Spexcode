import { ForgeCache } from './cache.js'
import { forgeDriverFor, resolveForgeHost } from './drivers.js'
import type { ForgeIssue, ForgePR } from './port.js'

const cache = new ForgeCache()
let inFlight: Promise<void> | null = null
let lastAttempt = 0
const TTL_MS = 20_000
let lastIssueSync: string | null = null
let lastFull = 0
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
    .catch(() => {})
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
