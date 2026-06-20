import type { ForgeDriver, ForgeIssue, ForgePR } from './port.js'
import { resolveLinks, type NodeLinks } from './links.js'

// @@@ freshness cache - the deterministic incremental-view-maintenance core of spec-forge. resolveLinks
// is already a PURE function of (open issues, open PRs, node ids); keeping the node→work view fresh
// without a cold full pull is therefore not a feature choice but the classic problem of maintaining
// `output = f(state)` as state changes. This holds the cached state and recomputes the pure view on read.
// What's incremental here is the FETCH, never the resolution: resolveLinks is microsecond-cheap, so we
// recompute it in full on every view() rather than incrementalize it. Host-agnostic — it sits beside
// links.ts and knows nothing of gh/webhooks; a delta is a delta whatever produced it.

// @@@ ForgeDelta - one observed change to the open set, the single currency every source emits. An
// upsert carries the whole new object (which carries its own number); a remove carries only what's
// needed to forget it (the object LEFT the open set — closed, merged, deleted, or marker-dropped). The
// poll source and the webhook source are interchangeable: both collapse to this, so the cache never
// learns which one spoke. Sources are HINTS, not truth — see reconcile.
export type ForgeDelta =
  | { kind: 'issue'; issue: ForgeIssue }
  | { kind: 'pr'; pr: ForgePR }
  | { kind: 'remove'; target: 'issue' | 'pr'; number: number }

// @@@ normalized open set - issues/PRs keyed by number so apply() is naturally idempotent (a duplicated
// or re-ordered delta just re-sets the same key) and a removed object is a single delete.
export class ForgeCache {
  private issues = new Map<number, ForgeIssue>()
  private prs = new Map<number, ForgePR>()

  // @@@ apply - fold one delta into the cached open set. Idempotent and order-tolerant by construction:
  // upsert is last-write-by-number, remove of an absent key is a no-op. That tolerance is the whole point
  // — webhooks arrive duplicated, out of order, or dropped, so a source may NOT be trusted to be a clean
  // stream; correctness is restored by reconcile, not by demanding perfect delivery here.
  apply(delta: ForgeDelta): void {
    if (delta.kind === 'issue') this.issues.set(delta.issue.number, delta.issue)
    else if (delta.kind === 'pr') this.prs.set(delta.pr.number, delta.pr)
    else (delta.target === 'issue' ? this.issues : this.prs).delete(delta.number)
  }

  // @@@ reconcile - the SOURCE OF TRUTH. A full read through the port overwrites the cached set wholesale,
  // repairing any drift left by dropped/duplicated/stale deltas. The convergence invariant the whole
  // design rests on: after reconcile(), view() equals a cold full pull BY CONSTRUCTION — so any number of
  // delta sources can only ever make the cache *temporarily* ahead of the last reconcile, never wrong for
  // long. Run it periodically as the backstop beneath whatever live source feeds apply().
  async reconcile(driver: ForgeDriver): Promise<void> {
    const [issues, prs] = await Promise.all([driver.listIssues(), driver.listPRs()])
    this.issues = new Map(issues.map((i) => [i.number, i]))
    this.prs = new Map(prs.map((p) => [p.number, p]))
  }

  // @@@ view - the resolved node→work output, recomputed in full from the cached set. Pure pass-through to
  // links.ts: the cache adds freshness, never a second resolution path, so a cached view and a full-pull
  // view are the SAME function of the same state and can never disagree on identical input.
  view(nodeIds: string[]): NodeLinks[] {
    return resolveLinks([...this.issues.values()], [...this.prs.values()], nodeIds)
  }
}
