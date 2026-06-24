// @@@ session view helpers - shared by every session surface (the top-right SessionWindow, the Enter
// SessionInterface, the SessionGraph, the mobile cards) so they label and colour a session identically.
// Previously each surface hand-rolled its own copy of these and they could silently drift.

// @@@ STATUS_COLOR - the SINGLE status→colour map. One source for BOTH the liveness dot AND the status
// word, on every surface, so a session's state reads the same hue wherever it appears (window row, console
// tab + header, @-mention row, search row, session graph, mobile card). Deliberately just FOUR hues — a
// traffic light plus grey — the word still spells the exact state; the colour only answers "does this need
// me?", so a glance sorts the board without a legend:
//   green  = on track, no action from you: working (busy) or parked (paused, will self-resume)
//   yellow = waiting on YOU: asking / review / done (answer it, or review & merge)
//   red    = error (something broke)
//   grey   = stopped / dormant: idle / starting / queued / close-pending / offline
// Values are theme tokens (styles.css :root) so the palette stays Solarized and single-sourced; green for
// `working` also agrees with the avatar liveness ring (av-st-working). var() resolves in inline styles.
export const STATUS_COLOR = {
  working: 'var(--green)', parked: 'var(--green)',
  asking: 'var(--yellow)', review: 'var(--yellow)', done: 'var(--yellow)',
  error: 'var(--red)',
  idle: 'var(--muted)', starting: 'var(--muted)', queued: 'var(--muted)',
  'close-pending': 'var(--muted)', offline: 'var(--muted)',
}

// the human-facing name of a session: a user-chosen rename (`name`) wins over everything; else its node,
// else title/branch, else the raw id. Mirrors the backend's sessionLabel precedence (spec-cli sessions.ts).
export const sessionName = (s) => s?.name || s?.node || s?.title || s?.branch || s?.id
