// Shared client timing for the board stream and terminal socket; tests pin this primitive to both server
// cadences. The transport promises and threat model live in [[dashboard-shell]] and [[reconnect]].
export const SERVER_PING_MS = 10000
export const DEAD_MS = 2.5 * SERVER_PING_MS

// One re-armable one-shot: arm replaces the current deadline, disarm removes it, and expiry transfers
// recovery to the caller. Timers stay injectable for the [[reconnect]] state-machine proof.
export function createDeadman(onDead, { deadMs = DEAD_MS, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
  let timer = 0
  const disarm = () => { if (timer) { clearTimeoutImpl(timer); timer = 0 } }
  const arm = () => {
    disarm()
    timer = setTimeoutImpl(() => { timer = 0; onDead() }, deadMs)
  }
  return { arm, disarm }
}
