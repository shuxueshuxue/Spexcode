// The client-side heartbeat contract ([[dashboard-shell]] / [[reconnect]]) — ONE module for both live
// channels. The server guarantees inbound traffic on every healthy link: a keep-alive ping every
// SERVER_PING_MS over the terminal WebSocket (TERM_PING_MS in spec-cli/src/index.ts) AND over the board
// SSE stream (graphStream.ts) — one cadence, one primitive, held equal to the server by test. A link
// silent past DEAD_MS (2.5× — absorbs one dropped ping plus jitter) is presumed DEAD, not merely quiet:
// the half-open tunnel / sleep-resume / NAT-reaped link that delivers no close and no error, only silence.
export const SERVER_PING_MS = 10000
export const DEAD_MS = 2.5 * SERVER_PING_MS

// Detection is EVENT-DRIVEN, never a polling loop: a dead-man's switch — one one-shot timer, re-armed by
// every inbound message — so on a healthy link it never fires and nothing wakes; DEAD_MS of total silence
// lets it fire once, at the deadline. A frozen tab runs no timers, so its overdue one-shot fires on
// unfreeze and converges immediately — same recovery, no visibilitychange hook. `onDead` decides what a
// breach means (force-drop, reopen…) and re-arms if it wants to keep watching. Timers are injectable so
// the switch is verifiable headlessly on a virtual clock.
export function createDeadman(onDead, { deadMs = DEAD_MS, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
  let timer = 0
  const disarm = () => { if (timer) { clearTimeoutImpl(timer); timer = 0 } }
  const arm = () => {
    disarm()
    timer = setTimeoutImpl(() => { timer = 0; onDead() }, deadMs)
  }
  return { arm, disarm }
}
