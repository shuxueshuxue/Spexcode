import { streamSSE } from 'hono/streaming'
import type { Context } from 'hono'
import { watch, mkdirSync, type FSWatcher } from 'node:fs'
import { sessionsRoot } from './layout.js'

// @@@ board-stream — the board's freshness is PUSHED, not polled. A dashboard subscribes here ONCE and
// reloads /api/board only when something actually changed, instead of re-fetching the whole ~328 KB board
// every few seconds. ONE event source feeds ALL subscribers: an fs.watch on the per-user session store, where
// every status transition lands (the harness hooks write `sessions/<id>/session.json`), so a record write IS
// the "board changed" signal for the hot path (session status/grouping — the thing that felt laggy under the
// poll). Cold-path changes (a spec edit/merge, a forge issue) are NOT watched here; they ride the dashboard's
// slow fallback poll. The event carries no board payload — it is a bare signal, and the client refetches
// /api/board (reusing that route's ETag/304 path), so this stream stays tiny and buildBoard stays on-demand.

type Notify = () => void
const subscribers = new Set<Notify>()
let watcher: FSWatcher | null = null
let debounce: ReturnType<typeof setTimeout> | null = null

// a merge/launch/close touches several record files at once; collapse the burst into ONE board-changed signal.
function fireChanged(): void {
  if (debounce) return
  debounce = setTimeout(() => {
    debounce = null
    for (const notify of [...subscribers]) { try { notify() } catch { /* a dead stream is swept on its own abort */ } }
  }, 150)
}

// lazily start the single shared watcher on the first subscriber. recursive: a new session is a new subdir and
// every status write lands nested in sessions/<id>/session.json. If the watch can't start, clients still work —
// they just fall back to the slow poll, so this never throws.
function ensureWatcher(): void {
  if (watcher) return
  const root = sessionsRoot()
  try { mkdirSync(root, { recursive: true }) } catch { /* best-effort; the watch below still tries */ }
  try { watcher = watch(root, { recursive: true }, () => fireChanged()) } catch { watcher = null }
}

// GET /api/board/stream — one SSE per dashboard tab. Server→client only (no request body, no client frames):
// emits `board-changed` on any session-store change, plus a periodic `ping` so an idle-proxy never times the
// connection out. On a backend hot-reload the stream drops and EventSource auto-reconnects to the fresh child,
// the same drop-and-reconnect the live pty bridges already do.
export function boardStream(c: Context) {
  ensureWatcher()
  return streamSSE(c, async (stream) => {
    let aborted = false
    const notify: Notify = () => { void stream.writeSSE({ event: 'board-changed', data: 'x' }).catch(() => {}) }
    subscribers.add(notify)
    stream.onAbort(() => { aborted = true; subscribers.delete(notify) })
    try {
      await stream.writeSSE({ event: 'ready', data: 'x' })
      while (!aborted) {
        await stream.sleep(25000)
        if (aborted) break
        await stream.writeSSE({ event: 'ping', data: 'x' })
      }
    } finally {
      subscribers.delete(notify)
    }
  })
}
