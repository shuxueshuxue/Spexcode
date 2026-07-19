// The review-track command registry ([[review-commands]]) — the sessionCommands.js pattern on the eval
// detail: each BUILT-IN review verb holds only its static identity + `when` gate here; the closure that
// DOES the thing is bound per-render by the host (EventDetail), and the composer's typed `/<name>` is the
// ONE dashboard door to the act — the gate lives in this registry alone, so every door (typed today, any
// future one) reads the same judgment. `when` gates on the viewed reading: /ok is offered exactly where
// the sign-off is legal — the viewed reading is the scenario's latest effective one and not yet human-ok'd
// ([[human-ok]] binds to one immutable reading; older A/B poles are history). Elsewhere it offers nothing.
export const REVIEW_COMMANDS = [
  { name: 'ok', color: 'green', when: (v) => !v.okd && v.isLatest, descKey: 'annotator.cmd.okDesc' },
]

// bind the static registry to the live per-render runners, keeping only the commands the viewed reading
// offers. `runners` maps each name to the one closure that DOES the thing.
export function reviewCommandsFor(view, runners) {
  return REVIEW_COMMANDS
    .filter((c) => c.when(view))
    .map((c) => ({ ...c, run: runners[c.name] }))
}

// fill a review preset's body at insert time — {node} {scenario} {expected} become the viewed reading's
// facts. Unknown {tokens} pass through untouched (the template stays raw-readable, never a crash).
export function fillPreset(body, ctx) {
  return (body || '').replace(/\{(\w+)\}/g, (m, k) => (ctx[k] != null ? String(ctx[k]) : m))
}
