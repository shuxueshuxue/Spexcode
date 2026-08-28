// ONE TABLE OF TIMELINE SHAPES, read by two instruments: the pure derivation (src/conversationItems.test.mjs)
// and the rendered Conversation in a real browser (test/conversation-working-tail.e2e.mjs). Each shape is one
// the status machine really writes — a human message into an already-active session leaves no status event
// behind, an `active` event may carry a note — and each expectation is the row list the reader is owed.
// `open` is the derivation's word for a seam nothing has closed; the browser turns it into the ticking
// `is-live` row when the session is live and into the bare word `working` when the record is dead.
export const LIFECYCLE = { working: 'active', asking: 'asking', parked: 'parked', error: 'error', queued: 'queued', 'close-pending': 'awaiting' }
const T0 = Date.parse('2026-08-27T15:40:00.000Z')
export const at = (seconds) => new Date(T0 + seconds * 1000).toISOString()
export const status = (seconds, display, note = null) => ({
  ts: at(seconds), kind: 'status', status: LIFECYCLE[display] ?? display, display,
  proposal: display === 'close-pending' ? 'close' : null, note,
})
export const sent = (seconds, text, from = null) => ({
  ts: at(seconds), kind: 'sent', mid: `m${seconds}`, text, from, ...(from ? {} : { replyVia: 'note' }),
})

export const SEAM_OPEN = { kind: 'seam', open: true }
export const SEAM = { kind: 'seam', open: false }
export const QUOTE = { kind: 'quote' }
export const SAY = (status) => ({ kind: 'say', status })
export const EVENT = (status) => ({ kind: 'event', status })

// `session` is what the board says now; `wasRight` records which shapes rendered correctly before the
// derivation tracked the agent's state, so a before/after run can prove the right ones stayed right.
export const SCENARIOS = [
  {
    name: 'awaiting-then-message-then-working',   // the first message of the bug report: its re-entry wrote a status event
    session: 'working',
    events: [status(0, 'working'), status(60, 'close-pending', 'landed'), sent(120, 'first message'), status(120.2, 'working')],
    expect: [SEAM, SAY('close-pending'), QUOTE, SEAM_OPEN],
    wasRight: true,
  },
  {
    name: 'second-message-while-working',         // the bug: one more message into the now-active session, no status event
    session: 'working',
    events: [status(0, 'working'), status(60, 'close-pending', 'landed'), sent(120, 'first message'), status(120.2, 'working'), sent(200, 'second message')],
    expect: [SEAM, SAY('close-pending'), QUOTE, SEAM, QUOTE, SEAM_OPEN],
    wasRight: false,
  },
  {
    name: 'message-while-working-then-asking',    // mid-history: the work after the message owns a seam and its transcript
    session: 'asking',
    events: [status(0, 'working'), sent(100, 'a message into a working agent'), status(400, 'asking', 'a question')],
    expect: [SEAM, QUOTE, SEAM, SAY('asking')],
    wasRight: false,
  },
  {
    name: 'active-with-note-then-asking',         // an `active` event carrying a note is a say; the work after it is a seam
    session: 'asking',
    events: [status(0, 'working'), status(30, 'working', 'launch readiness warning: post-receipt adapter liveness'), status(300, 'asking', 'done with that')],
    expect: [SEAM, SAY('working'), SEAM, SAY('asking')],
    wasRight: false,
  },
  {
    name: 'peer-message-into-asking-session',     // a message that lands on a NOT-working agent claims no work
    session: 'asking',
    events: [status(0, 'working'), status(60, 'asking', 'waiting on review'), sent(90, 'peer reply\n— from session peer-1. To reply: spex session send peer-1 "<your reply>"', 'peer-1')],
    expect: [SEAM, SAY('asking'), QUOTE],
    wasRight: true,
  },
  {
    name: 'error-then-message-then-working',      // an error is an instant; the re-entry opens the seam, nothing before it
    session: 'working',
    events: [status(0, 'working'), status(40, 'error', 'claude turn failed'), sent(80, 'try again'), status(80.3, 'working')],
    expect: [SEAM, EVENT('error'), QUOTE, SEAM_OPEN],
    wasRight: true,
  },
  {
    name: 'dead-record-last-word-working',        // an offline record whose last word is working: a still `working`, no duration invented
    session: 'offline',
    events: [status(0, 'working'), sent(50, 'hello'), status(50.2, 'working')],
    expect: [SEAM, QUOTE, SEAM_OPEN],
    wasRight: true,
  },
]
