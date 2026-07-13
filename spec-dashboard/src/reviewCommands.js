// The review-track command registry ([[review-commands]]) — the sessionCommands.js pattern on the eval
// detail: each BUILT-IN review verb holds only its static identity + `when` gate here; the closure that
// DOES the thing is bound per-render by the host (EventDetail), and the header BUTTON and the composer's
// typed `/<name>` run that SAME closure through this one registry, so button and command can never drift.
// `when` gates on the viewed reading: /ok is offered exactly where the ok button renders — the viewed
// reading is the scenario's latest effective one and not yet human-ok'd ([[human-ok]] binds to one
// immutable reading; older A/B poles are history). Typed anywhere the button is disabled, it offers nothing.
export const REVIEW_COMMANDS = [
  { name: 'ok', color: 'green', when: (v) => !v.okd && v.isLatest,
    labelKey: 'annotator.ok', titleKey: 'annotator.okTitle', descKey: 'annotator.cmd.okDesc' },
]

// bind the static registry to the live per-render runners, keeping only the commands the viewed reading
// offers. `runners` maps name → the closure that DOES the thing (the same closure the header button calls).
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
