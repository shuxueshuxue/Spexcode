import { reviewPayload, type ReviewEvalGate, type ReviewPayload } from './sessions.js'
import { sessionEvalProjection } from '../../spec-eval/src/sessioneval.js'

// @@@ cockpit - where the manager's review answer is ASSEMBLED ([[manager-cockpit]]). It sits above both the
// session layer and the eval layer and may import either; that is what makes it the only honest home for a
// value composed from both. `sessions.ts` cannot be that home — the eval package imports it, so reaching the
// other way from there is a cycle, and the cycle used to be paid for with a deferred `await import()` whose
// comment explained why it had to be wrong. `reviews.ts` cannot be it either: that file is [[paged-review]]'s
// Issues/Evals paging server, and parking a session-cockpit concern under a node about paging would make that
// node's body false. It imports the eval package for its own reasons — the same direction, a different one.

// @@@ ONE composition, every entry point - `gates.evals` has exactly one producer, and it is this function.
// The cockpit review is reachable two ways: the HTTP route, and `clientReview`'s local answer when no backend
// resolves. If each composed its own gates, the same verb would report different shapes depending on whether a
// backend happened to be running — the very asymmetry the remote-client role split exists to remove — and a
// drift between the two readouts would be caught by no gate we have. So both call HERE.
export type CockpitReview = Omit<ReviewPayload, 'gates'> & {
  gates: ReviewPayload['gates'] & { evals: ReviewEvalGate }
}

// @@@ evalGate - the measured-loss readout, taken from [[session-eval]]'s EXISTING projection. This is a cache
// READ and must stay one: `buildSessionEvals()` calls `reviewPayload()` itself, so BUILDING the model from here
// would recurse. That hazard used to be held off by a comment; now it is structural — `reviewPayload` no longer
// carries this field, so the eval side cannot re-enter through it. (It never read the field anyway: `gateRows`
// consumes lint/conflict/ahead/dirty only. The payload was carrying a value for a caller that ignored it.)
async function evalGate(id: string): Promise<ReviewEvalGate> {
  const projection = sessionEvalProjection(id)
  if (!projection) return { phase: 'unavailable' }
  // only a `ready` projection carries a CURRENT value; last-known is deliberately not reported as current.
  if (projection.phase !== 'ready' || !projection.value) {
    return { phase: projection.phase === 'ready' ? 'unavailable' : projection.phase }
  }
  const summary = projection.value
  return { phase: 'ready', freshPass: summary.pass, freshFail: summary.fail, needReview: summary.review, blind: summary.blind }
}

// the cockpit's whole answer for one session: the session-side review plus the eval readout, composed once.
// The two run in parallel — the eval half is a projection read, independent of every git read in the payload.
export async function cockpitReview(id: string): Promise<CockpitReview | null> {
  const [payload, evals] = await Promise.all([reviewPayload(id), evalGate(id)])
  if (!payload) return null
  return { ...payload, gates: { ...payload.gates, evals } }
}
