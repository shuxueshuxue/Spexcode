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

// the STABLE identity of a session: a user-chosen rename (`name`) wins over everything; else its node,
// else title/branch, else the raw id. Mirrors the backend's sessionLabel precedence (spec-cli sessions.ts).
// Used where a session needs a fixed handle that doesn't move turn-to-turn — tooltips, the lock hint, search.
export const sessionName = (s) => s?.name || s?.node || s?.title || s?.branch || s?.id

// @@@ sessionHeadline - the row's HEADLINE (line 1): what this session is ABOUT, preferring the smartest
// description available. A human rename (`name`) still wins — the [[session-rename]] override is
// authoritative everywhere. Otherwise the worker's LIVE tmux self-summary (`activity`, see [[session-activity]])
// takes the line: an agent-generated description of what it's doing right now, sharper than the few words a
// human typed at launch. Before that label exists (booting / queued / offline) it falls back to the first
// words of the launch prompt (`promptPreview`) as a placeholder, then node / title / branch / id. Distinct
// from sessionName: the headline is ALLOWED to change each turn as the agent renarrates — the avatar (seeded
// by id) is the fixed spatial anchor, not this line.
export const sessionHeadline = (s) =>
  s?.name || s?.activity || s?.promptPreview || s?.node || s?.title || s?.branch || s?.id
