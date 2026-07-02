import { ForgeCache } from './cache.js'
import { githubDriver } from './drivers/github.js'
import type { ForgeIssue, ForgePR } from './port.js'

const cache = new ForgeCache()
let inFlight: Promise<void> | null = null
// track last ATTEMPT, not last success, so the TTL also backs off failures — else a forge-less repo respawns `gh` every poll
let lastAttempt = 0
const TTL_MS = 60_000
// incremental-first: after the seeding full reconcile, each TTL cycle fetches only the updated-since
// window (tiny — normally one page) and merges it; a periodic full reconcile stays as the backstop for
// what an update window can't see (deleted/transferred issues).
let lastIssueSync: string | null = null
let lastFull = 0
const FULL_MS = 30 * 60_000

function refreshIfStale(now: number): void {
  if (inFlight || (lastAttempt && now - lastAttempt < TTL_MS)) return
  lastAttempt = now
  const startISO = new Date(now).toISOString()   // stamped at fetch START so an update during the fetch lands in the next window
  const incremental = lastIssueSync && githubDriver.listIssuesSince && now - lastFull < FULL_MS
  inFlight = (incremental
    ? Promise.all([
        githubDriver.listIssuesSince!(lastIssueSync!).then((delta) => cache.applyIssues(delta)),
        githubDriver.listPRs().then((prs) => cache.setPRs(prs)),
      ]).then(() => { lastIssueSync = startISO })
    : cache.reconcile(githubDriver).then(() => { lastFull = now; lastIssueSync = startISO })
  )
    .catch(() => {})
    .finally(() => { inFlight = null })
}

// the raw cached forge set, same freshness contract as the view (instant, background reconcile) — the
// server-side slice the unified Issue port (spec-cli issues.ts) merges with the local forum.
export function residentForgeState(): { issues: ForgeIssue[]; prs: ForgePR[] } {
  refreshIfStale(Date.now())
  return cache.state()
}

// a write must show up where it lands: after the server posts a forge comment, force one refresh past the
// TTL and await it, so the next read carries the real read-back (never a local echo). Coalesces with an
// in-flight cycle first — a refresh started BEFORE the write could read the pre-write world. The forced
// cycle is a FULL re-list, never the incremental window: the REST since-read can lag a just-posted write,
// and a lagged cycle advances the watermark PAST it — the write would then be invisible until the next
// full reconcile. The full list reads the same backend the write went to, so the read-back is real.
export async function refreshForgeNow(): Promise<void> {
  if (inFlight) await inFlight
  lastAttempt = 0
  lastFull = 0
  refreshIfStale(Date.now())
  if (inFlight) await inFlight
}
