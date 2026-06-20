// @@@ resilience - the backend reads the worktree set LIVE on every /api/layout & /api/board, and a
// dispatched worker can self-merge and have its worktree REMOVED at any instant (the merge ritual deletes
// the node branch + retires the worktree). That makes every per-worktree path read a RACE: an existsSync
// can pass and the readFileSync a microsecond later throw ENOENT because the directory vanished underneath
// us. Such a throw used to propagate out of resolveLayout()/listSessions(), out of the request handler,
// and — as an unhandled async rejection — EXIT the process, taking the backend (and the Vite-proxied
// frontend) down with it. This module is the two-layer guard: (1) guardWorktree wraps each per-worktree
// read so a vanished entry is SKIPPED with one log line instead of crashing the whole board; (2)
// installProcessGuards is the last-resort net — any unforeseen uncaught error/rejection is logged and the
// process KEEPS SERVING rather than exiting. Neither swallows silently: every skip and every caught crash
// is logged, so a real bug stays loud — it just no longer kills the server.

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// run a per-worktree read; on ANY throw, log one line naming the worktree and return null so the caller
// drops just that one entry (never the whole list). Accepts a sync OR async fn — resolveLayout's overlay
// read is async, listSessions' row read is sync.
export async function guardWorktree<T>(label: string, fn: () => T | Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (e) {
    console.warn(`spec-cli: skipped worktree ${label} (vanished or unreadable mid-read): ${describe(e)}`)
    return null
  }
}

// the last-resort process net: log an otherwise-fatal async throw and KEEP SERVING. Registering these
// handlers is itself what overrides Node's default "print the stack and exit" — so the backend rides out
// a transient race it didn't anticipate instead of dropping the public port. Idempotent (guarded) so a
// double-install in one process can't stack duplicate handlers.
let guardsInstalled = false
export function installProcessGuards(): void {
  if (guardsInstalled) return
  guardsInstalled = true
  process.on('unhandledRejection', (reason) => {
    console.error(`spec-cli: unhandledRejection kept the server alive (investigate): ${reason instanceof Error ? reason.stack : describe(reason)}`)
  })
  process.on('uncaughtException', (err) => {
    console.error(`spec-cli: uncaughtException kept the server alive (investigate): ${err?.stack || describe(err)}`)
  })
}
