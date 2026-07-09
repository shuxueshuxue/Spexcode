import { ForgeCache } from './cache.js'
import { forgeDriverFor, resolveForgeHost } from './drivers.js'
import type { ForgeIssue, ForgePR } from './port.js'

const cache = new ForgeCache()
let inFlight: Promise<void> | null = null
// track last ATTEMPT, not last success, so the TTL also backs off failures — else a forge-less repo respawns `gh` every poll
let lastAttempt = 0
// tuned to the dashboard's LIVE cadence: the issues page re-polls /api/issues every ~15s and each poll
// opportunistically triggers this refresh, so a TTL near the poll cadence means an externally-posted forge
// issue surfaces on the board within ~one poll+cycle (~15–30s) with no page reload — the "post a github
// issue → it just appears" contract. Each cycle is a tiny incremental read (one page), well inside
// GitHub's rate budget; the back-off still covers a forge-less repo (a failed probe updates lastAttempt).
const TTL_MS = 20_000
// incremental-first: after the seeding full reconcile, each TTL cycle fetches only the updated-since
// window (tiny — normally one page) and merges it; a periodic full reconcile stays as the backstop for
// what an update window can't see (deleted/transferred issues).
let lastIssueSync: string | null = null
let lastFull = 0
const FULL_MS = 30 * 60_000

function refreshIfStale(now: number): void {
  if (inFlight || (lastAttempt && now - lastAttempt < TTL_MS)) return
  // the driver is picked per cycle from the RESOLVED host ([[forge-host]]: repo remote / forge.host
  // override) — a host whose driver isn't registered yet (e.g. a gitlab remote before a gitlab driver
  // lands) keeps the slice empty without spawning anything, never a wrong-host `gh` call or a throw
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

// the raw cached forge set, same freshness contract as the view (instant, background reconcile) — the
// server-side slice the unified Issue port (spec-cli issues.ts) merges with the local store.
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
