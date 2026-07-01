import { streamSSE } from 'hono/streaming'
import type { Context } from 'hono'
import { watch, mkdirSync, type FSWatcher } from 'node:fs'
import { sessionsRoot } from './layout.js'
import { sessionSignature } from './sessions.js'

// @@@ board-stream — the board's freshness is PUSHED, not polled. A dashboard subscribes here ONCE and
// reloads /api/board only when something actually changed, instead of re-fetching the whole board every few
// seconds. TWO event sources feed ALL subscribers, both firing the SAME bare `board-changed` signal (the
// client then refetches /api/board — reusing its ETag/304 path — so this stream stays tiny and buildBoard
// stays on-demand): (1) an fs.watch on the per-user session store, where every lifecycle status transition
// lands as a `sessions/<id>/session.json` write; (2) a subscriber-gated poll of the CHEAP session signature
// ([[sessions]]) for the two signals that are tmux-derived, NOT file writes — LIVENESS (a crash/offline) and
// ACTIVITY (a worker's live self-summary title) — which the fs-watch can't see. Only the truly-cold path (a
// spec edit/merge, a forge issue) rides the dashboard's slow fallback poll now.

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

// event source #2: poll the cheap tmux-derived session signature (liveness + activity) while anyone is
// subscribed, firing board-changed the moment it moves — so a crash/offline or a live headline reflects in
// ~2s, not on the slow fallback. Two tmux calls per tick, NO git; gated on subscribers so a closed dashboard
// costs nothing. The fs-watch stays the instant path for status writes; this only catches what a file can't.
let poller: ReturnType<typeof setInterval> | null = null
let lastSig = ''
function ensureLivePoll(): void {
  if (poller) return
  poller = setInterval(() => {
    void sessionSignature().then((sig) => { if (sig !== lastSig) { lastSig = sig; fireChanged() } }).catch(() => {})
  }, 2000)
}
function stopLivePollIfIdle(): void {
  if (poller && subscribers.size === 0) { clearInterval(poller); poller = null; lastSig = '' }
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
    ensureLivePoll()
    stream.onAbort(() => { aborted = true; subscribers.delete(notify); stopLivePollIfIdle() })
    try {
      await stream.writeSSE({ event: 'ready', data: 'x' })
      while (!aborted) {
        await stream.sleep(25000)
        if (aborted) break
        await stream.writeSSE({ event: 'ping', data: 'x' })
      }
    } finally {
      subscribers.delete(notify)
      stopLivePollIfIdle()
    }
  })
}
