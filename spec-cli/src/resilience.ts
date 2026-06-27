import { existsSync } from 'node:fs'

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// run a per-worktree DETAIL read; on a throw, branch on whether the worktree DIRECTORY still exists.
//   dir gone   → the worktree was genuinely removed mid-read → return null so the caller omits it.
//   dir present → a flaky detail read (ENOENT race on a sibling file, or a git index/ref lock under a
//                 concurrent merge) → return the caller's `degraded` row so an EXISTING worktree is NEVER
//                 dropped from the board. read-failure != non-existence.
// `dir` is the worktree path (the existence fact). Accepts a sync OR async fn — resolveLayout's overlay
// read is async, listSessions' row read is sync; `degraded` is a sync raw-facts fallback.
export async function guardWorktree<T>(dir: string, fn: () => T | Promise<T>, degraded: () => T): Promise<T | null> {
  try {
    return await fn()
  } catch (e) {
    if (!existsSync(dir)) {
      console.warn(`spec-cli: worktree ${dir} gone from disk (removed mid-read), omitting: ${describe(e)}`)
      return null
    }
    console.warn(`spec-cli: worktree ${dir} detail-read failed (transient/lock); serving degraded row: ${describe(e)}`)
    return degraded()
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
