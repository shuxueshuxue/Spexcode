// status→colour values are theme tokens (styles.css :root) so the palette stays single-sourced; var() resolves in inline styles.
export const STATUS_COLOR = {
  working: 'var(--green)', parked: 'var(--green)',
  asking: 'var(--yellow)', review: 'var(--yellow)', done: 'var(--yellow)',
  error: 'var(--red)',
  idle: 'var(--muted)', starting: 'var(--muted)', queued: 'var(--muted)',
  'close-pending': 'var(--muted)', offline: 'var(--muted)',
}

// compact one-line surfaces (the console's terminal-styled sidebar) render the status as a SINGLE glyph
// instead of the word — STATUS_COLOR still paints it, and the exact word stays in the title/aria for hover +
// a11y. One terminal-ish mark per lifecycle; same four-hue traffic-light meaning as the word it replaces.
export const STATUS_GLYPH = {
  working: '●', parked: '‖',
  asking: '?', review: '◑', done: '✓',
  error: '✕',
  idle: '·', starting: '◌', queued: '⋯', 'close-pending': '⊘', offline: '○',
}

// the three triage zones the session list groups into — "whose turn is it?". `offline` = the process is
// DEAD/dormant (can't act until relaunched) — checked FIRST, because a session whose process died while
// asking/review/error keeps that pre-death lifecycle, yet it belongs at the bottom, not under Needs You.
// `need` = the ball is with the HUMAN (asking / review / done / close-pending / error → answer, review,
// close, fix); `run` = self-driving, the agent's turn (working / parked / starting / queued / idle — booting
// counts as running, not dead). Closed sessions aren't on the board at all. Same partition drives every
// session-list surface.
const NEED_STATUS = new Set(['asking', 'review', 'done', 'close-pending', 'error'])
export const sessionZone = (s) => {
  if (s?.liveness === 'offline' || s?.status === 'offline') return 'offline'
  return NEED_STATUS.has(s?.status) ? 'need' : 'run'
}
export const ZONE_ORDER = ['need', 'run', 'offline']
// zone-partition the list: needs-you first, self-running next, offline (dormant) at the bottom; and WITHIN
// each zone the NEWEST session on top (descending effective time) — the fresh, recently-touched work you
// actually reach for, not the oldest.
const effOf = (s) => (s?.sortKey != null ? s.sortKey : (s?.created ?? 0))
export const zoneSort = (sessions) => {
  const rank = { need: 0, run: 1, offline: 2 }
  return [...sessions].sort((a, b) => rank[sessionZone(a)] - rank[sessionZone(b)] || effOf(b) - effOf(a))
}

// the STABLE identity of a session: a user-chosen rename (`name`) wins over everything; else its node,
// else title/branch, else the raw id. Mirrors the backend's sessionLabel precedence (spec-cli sessions.ts).
// Used where a session needs a fixed handle that doesn't move turn-to-turn — tooltips, the lock hint, search.
export const sessionName = (s) => s?.name || s?.node || s?.title || s?.branch || s?.id

export const sessionHeadline = (s) =>
  s?.name || s?.activity || s?.promptPreview || s?.node || s?.title || s?.branch || s?.id
