// @@@ session view helpers - shared by every session surface (the top-right SessionWindow, the Enter
// SessionInterface, the SessionGraph, the mobile cards) so they label and colour a session identically.
// Previously each surface hand-rolled its own copy of these and they could silently drift.

// @@@ STATUS_COLOR - the SINGLE status→colour map. One source for BOTH the liveness dot AND the status
// word, on every surface, so a session's state reads the same hue wherever it appears (window row, console
// tab + header, @-mention row, search row, session graph, mobile card). The hues are a 6-bucket SEMANTIC
// code — the word still spells the exact state; the colour answers "does this need me?":
//   green = working (active)        yellow = asking (blocked, needs a human answer)   red = error
//   blue  = review / done (a checkpoint reached — your move)        cyan = parked (paused on purpose)
//   grey  = idle / starting / queued / close-pending / offline (inactive, not its turn)
// Values are theme tokens (styles.css :root) so the palette stays Solarized and single-sourced; green for
// `working` also agrees with the avatar liveness ring (av-st-working). var() resolves in inline styles.
export const STATUS_COLOR = {
  working: 'var(--green)',
  asking: 'var(--yellow)',
  error: 'var(--red)',
  review: 'var(--blue)', done: 'var(--blue)',
  parked: 'var(--cyan)',
  idle: 'var(--muted)', starting: 'var(--muted)', queued: 'var(--muted)',
  'close-pending': 'var(--muted)', offline: 'var(--muted)',
}

// the human-facing name of a session: a user-chosen rename (`name`) wins over everything; else its node,
// else title/branch, else the raw id. Mirrors the backend's sessionLabel precedence (spec-cli sessions.ts).
export const sessionName = (s) => s?.name || s?.node || s?.title || s?.branch || s?.id
