// @@@ session view helpers - shared by every session surface (the top-right SessionWindow, the Enter
// SessionInterface, the SessionGraph) so they label and colour a session identically. Previously each
// surface hand-rolled its own copy of these and they could silently drift.

// session liveness -> dot colour. The SINGLE source for the status dot drawn in the session window, the
// session list, and the @-mention rows — a session's status reads the same colour wherever it appears.
export const STATUS_DOT = {
  working: '#cb4b16', idle: '#93a1a1', offline: '#657b83', review: '#6c71c4', done: '#268bd2',
  'close-pending': '#cb4b16', parked: '#2aa198', error: '#dc322f', asking: '#b58900',
}

// the human-facing name of a session: a user-chosen rename (`name`) wins over everything; else its node,
// else title/branch, else the raw id. Mirrors the backend's sessionLabel precedence (spec-cli sessions.ts).
export const sessionName = (s) => s?.name || s?.node || s?.title || s?.branch || s?.id
