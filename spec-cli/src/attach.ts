// @@@ session attach - the HUMAN escape hatch into a worker: every session is just a tmux session on the
// backend's private socket, and the most direct way to see or rescue one is to sit in it. This verb is the
// sanctioned foreground `tmux attach` — no programmatic exception-handling ambition, the user fixes it by
// being there. It is deliberately the ONE session verb that does NOT route through the backend
// ([[remote-client]]'s exception): a terminal cannot be brokered over HTTP, and attaching a tmux CLIENT to
// the same server is tmux's native multi-client support, not a second actor on the socket. That makes it
// LOCAL-only by nature — the guards below fail loud (never degrade) when the premise doesn't hold.
import { spawnSync } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { alive, apiBase, TMUX_SOCK } from './sessions.js'

const AGENT_ALTERNATIVES = 'read the pane with `spex session capture`, drive it with `session send` / `session rawkey`'

// attach only makes sense on the machine that runs the tmux server — the backend's. The board the selector
// resolved against IS that backend, so the test is: does the RESOLVED backend (see [[remote-client]]'s
// ladder — flag / worker env / cwd record / fallback) point at this machine? Loopback and any address this
// host owns count as local; anything else (a tailnet/LAN IP of another box, a hostname we can't claim)
// fails loud with the reason and the remote-capable alternatives, never a silent local fallback onto a
// tmux socket that holds no sessions.
export async function assertLocalBackend(): Promise<void> {
  const base = await apiBase()
  let host: string
  try { host = new URL(base).hostname } catch { host = '' }
  const mine = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
  for (const addrs of Object.values(networkInterfaces())) for (const a of addrs ?? []) mine.add(a.address)
  if (mine.has(host)) return
  console.error(`spex session attach: attach is LOCAL-only, and the resolved backend is another machine (${base}).
The tmux session lives on THAT machine — a terminal can't be attached over HTTP. Either run attach there
(e.g. over ssh), or ${AGENT_ALTERNATIVES} — those work remotely.`)
  process.exit(2)
}

// foreground takeover of the session's real tmux window; returns only via detach (C-b d) or the session
// ending. Interactive and blocking by design — a caller without a terminal (an agent inside its turn, a
// pipe) is refused up front and pointed at the remote-capable verbs instead of tmux's bare "not a terminal".
export async function attachSession(id: string): Promise<never> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(`spex session attach: attach is INTERACTIVE and needs a terminal — it blocks until you detach.
An agent must not run it inside a turn (it freezes you); ${AGENT_ALTERNATIVES}.`)
    process.exit(2)
  }
  if (!(await alive(id))) {
    console.error(`spex session attach: ${id} is offline — no live tmux session to attach.
Bring it back with \`spex session reopen ${id}\`, or read its record with \`spex ls ${id}\`.`)
    process.exit(1)
  }
  console.log(`attaching to ${id} — detach with C-b d (the session keeps running)`)
  const r = spawnSync('tmux', ['-u', '-L', TMUX_SOCK, 'attach-session', '-t', id], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}
