import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { createHash, randomBytes } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { claudeSlashCommands, codexSlashCommands, type SlashCommand } from './slash-commands.js'
import { runtimeRoot, mainCheckout } from './layout.js'

// @@@ harness-adapter - the ONE seam between SpexCode and the coding-agent harness (Claude Code, Codex, …).
// Every harness-specific fact lives behind THIS interface with one implementation per harness; product code
// (materialize, sessions, slash, the hook scripts) never branches on which harness it is — it resolves an
// adapter ONCE and calls it. The only `if (codex)` / `if (claude)` in the whole product is the detector that
// picks the adapter (here), plus its shell mirror in hooks/harness.sh (shell cannot import this module).
//
// DETECTION. There is no payload-sniffing: each adapter OWNS its shim, and the shim bakes the harness id as
// dispatch.sh's first argument (`bash <dispatch> <id> <Event>`). dispatch.sh exports SPEXCODE_HARNESS, so a
// hook subprocess learns its harness deterministically from the shim that wired it — never from guessing the
// payload shape. On the TS side the harness is the launcher's choice (the dashboard launches `defaultHarness`)
// or ALL adapters at once (materialize renders every harness's artifacts).

export type HarnessId = 'claude' | 'codex'
export type HarnessLivenessRecord = { session: string; harnessSessionId?: string | null }

export interface Harness {
  readonly id: HarnessId
  // the lifecycle events this harness fires (drives the shim + the trust hashes). Claude binds the full set;
  // Codex's canonical hook event set (its `HookEventName` enum, codex 0.142.3) has no failed-stop and no
  // idle/attention event, so Codex has NO equivalent of StopFailure / Notification — a real harness difference,
  // not a TODO. It binds only the five it actually fires (see CODEX_EVENTS).
  readonly events: readonly string[]
  // whether the harness's agent opens a reclaude rendezvous control socket. Claude does; Codex has no such
  // daemon and uses its app-server JSON-RPC control plane instead.
  readonly ownsRendezvous: boolean
  // whether this harness's tmux pane_title is the agent's OWN live task self-summary (so the board headline
  // may derive from it — see [[session-activity]]). Claude continuously writes a one-line task summary into
  // its OSC title → true. Codex sets the pane title to a spinner glyph + the cwd basename (the worktree FOLDER
  // name), which is NOT a self-summary → false, so its headline falls through to the launch-prompt preview
  // instead of showing the folder name. This is the ONLY harness branch in the headline path: the capability
  // is data on the adapter, not an `if (codex)` in sessions.ts.
  readonly paneTitleIsSelfSummary: boolean

  // --- launch / sessionId ---
  // the base agent command (env-overridable for tests). Claude: `claude …`; Codex starts a project-scoped
  // app-server and launches the visible TUI with `--remote` pointed at it.
  launchCmd(id: string, runtimeDir?: string): string
  // the flag that pins the session id at launch. Claude lets the caller choose (`--session-id <id>`); Codex
  // assigns its own, so there is nothing to pass (the id is captured/resumed afterwards).
  sessionIdArg(id: string): string
  // the env var the agent's OWN process carries so its `spex …` calls know their session id.
  readonly sessionEnvVar: string

  // --- materialize: shim + contract + trust ([[harness-delivery]]) ---
  // the auto-discovered hook shim file for this harness (.claude/settings.json vs .codex/hooks.json).
  shimFile(proj: string): string
  // the contract file(s) the `surface: system` block is folded into. Claude: ./CLAUDE.md; Codex: ONLY ./AGENTS.md.
  contractFiles(proj: string): string[]
  // the dir this harness auto-discovers skills from, or null if it has no skill primitive — the ONLY place skill-surface divergence lives.
  skillDir(proj: string): string | null
  // the shim payload: the settings/hooks JSON binding every event → the dispatcher (harness id baked in), and
  // the per-event command string (shared with the trust writer so they hash identically).
  shim(dispatch: string, spex: string): { json: string; cmd: (e: string) => string }
  // make a user-self-launched agent run the hooks with zero prompts. Codex writes a deterministic trusted_hash
  // into the GLOBAL ~/.codex/config.toml (codex's security model: trust is global-only); Claude is a no-op
  // (it relies on folder-trust). `cmdFor` MUST be the same per-event command the shim emitted.
  writeTrust(proj: string, cmdFor: (e: string) => string): void

  // --- the `/` menu ---
  // the slash-command list, computed the way THIS harness computes its own `/` menu.
  slashCommands(): SlashCommand[]

  // --- runtime: liveness + prompt delivery ([[harness-delivery]]) ---
  // is this session's agent process up? The caller passes in the tmux-window presence it already computed
  // (one tmux snapshot for the whole list — see sessions.ts liveTmux), and the adapter adds ONLY its own
  // channel check. claude: online iff the tmux window is up AND its reclaude rendezvous socket exists (the
  // socket is the truth claude is alive — the pane command is the wrapper/shell while claude runs as a child).
  // codex: online iff the tmux window is up AND the project-scoped app-server socket exists (one socket per
  // PROJECT, shared by every worktree's thread); the per-session window presence is the session signal, the
  // socket is a project control plane, not session identity.
  liveness(rec: HarnessLivenessRecord, tmuxAlive: boolean, runtimeDir?: string): 'online' | 'offline'
  // deliver a follow-up prompt to a LIVE session and report whether it landed. claude: through the rendezvous
  // control socket, which injects + submits the prompt and CONFIRMS the daemon accepted it (loud failure on a
  // missing/dead socket — never a silent degradation). codex: JSON-RPC on the same app-server WebSocket the
  // visible TUI uses — it reads the thread live and either `turn/steer`s the message INTO an in-progress turn
  // (mid-turn, not queued for after the agent stops) or `turn/start`s a fresh turn when the thread is idle.
  // Returns ok=false with a reason that propagates to the API.
  deliver(rec: HarnessDeliveryRecord, text: string): Promise<DispatchResult>
  // the relaunch tail reopen() hands launch() to bring the SAME work back up. claude resumes the same
  // conversation (`--resume <id>`, the id we pinned at launch). codex's own thread id is un-pinnable on the
  // launch flag, so the BACKEND owns it: it `thread/start`s the thread and stores the id at launch, so reopen
  // resumes the SAME conversation via codex's own `resume <thread-id>` subcommand (the stored harnessSessionId,
  // its rollout persisted on disk). Only a session whose thread id was never stored relaunches FRESH (empty
  // tail) in the same worktree/record — there is nothing to resume.
  resumeArg(rec: { session: string; harnessSessionId?: string | null }): string
}

// a prompt-dispatch outcome. ok=true ONLY when delivery is CONFIRMED (claude: the daemon ACCEPTED the prompt;
// codex: app-server accepted `turn/start`). `error` carries a human-readable reason that propagates to the
// API route (non-2xx) and the CLI/dashboard. Defined here because it is the harness DELIVERY contract; sessions.ts
// re-exports it for its existing importers.
export type DispatchResult = { ok: boolean; error?: string }
export type HarnessDeliveryRecord = { session: string; worktreePath?: string; harnessSessionId?: string | null; runtimeDir?: string }

// @@@ rendezvous control socket - claude's DETERMINISTIC, ONLY input path for PROMPTS to sessions WE launch.
// sessions.ts starts `claude` with CLAUDE_BG_BACKEND=daemon + CLAUDE_BG_RENDEZVOUS_SOCK=<this path> set ONLY on
// that one spawned command (env prefix, never global). claude opens a unix socket here; writing one line
// `{"type":"reply","text":"…"}\n` injects + submits the text as a prompt — no PTY typing, so multi-line input
// and Enters can't be corrupted the way `tmux send-keys` was. The path is uniquely derived from the session id,
// so we only ever address OUR OWN sockets (HARD ethics rule: never touch a session outside this product). It
// lives in tmpdir tied to the claude process, so no extra lifecycle. liveness reads its existence (present while
// claude is alive, gone once it exits); deliver writes to it. Exported because sessions.ts builds the launch env
// var from it and best-effort sweeps it on close — but the liveness/delivery USE is the adapter's, below.
export const rvSock = (id: string) => join(tmpdir(), `spexcode-rv-${id}.sock`)
export const codexAppServerSock = (dir = process.env.SPEXCODE_CODEX_SOCKET_DIR || tmpdir()) => join(dir, 'codex-app-server.sock')
export const codexAppServerPid = (dir = process.env.SPEXCODE_CODEX_SOCKET_DIR || tmpdir()) => join(dir, 'codex-app-server.pid')

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

// the tsx + cli.ts invocation, baked into the codex launch script (mirrors materialize.ts's SPEX) so the
// launch shell can call back into `spex codex-launch` to own the thread + fire the first turn before it
// exec's the visible TUI.
const PKG = fileURLToPath(new URL('..', import.meta.url))
const SPEX = `${join(PKG, 'node_modules', '.bin', 'tsx')} ${join(PKG, 'src', 'cli.ts')}`

const ACCEPT_TIMEOUT_MS = 2500
// @@@ replyViaSocket - inject `text` as a prompt AND confirm the daemon ACCEPTED it (not mere write-success,
// which is what silently masked dead dispatches before). The CLAUDE_BG_BACKEND=daemon rendezvous server sends
// NO ack for an accepted reply, so we confirm via an IN-ORDER round-trip: we write `{type:reply}\n{type:repaint}\n`.
// The daemon dispatches socket lines strictly in order and ENQUEUES the reply BEFORE it handles the repaint and
// answers `{type:repaint-done}` — so a `repaint-done` with NO preceding `reply-rejected` proves the reply was
// processed. `repaint` is auth-exempt and always answers, so it's a reliable probe even against a future daemon
// that gates `reply` behind auth (a gated reply emits `reply-rejected` FIRST). `reply-rejected`/`shutting-down`,
// a connect/socket error, an early close, or no confirmation within ACCEPT_TIMEOUT_MS ALL resolve to a loud
// failure with a specific reason. The forced repaint is a harmless redraw of the agent's OWN TUI. Never throws.
function replyViaSocket(sock: string, text: string): Promise<DispatchResult> {
  return new Promise((resolve) => {
    let settled = false, buf = ''
    let c: ReturnType<typeof createConnection>
    const done = (r: DispatchResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { c?.destroy() } catch { /* */ }
      resolve(r)
    }
    const timer = setTimeout(
      () => done({ ok: false, error: `rendezvous socket gave no acceptance confirmation within ${ACCEPT_TIMEOUT_MS}ms` }),
      ACCEPT_TIMEOUT_MS,
    )
    try {
      c = createConnection({ path: sock })
    } catch (e) {
      done({ ok: false, error: `rendezvous socket connect threw: ${String(e)}` })
      return
    }
    c.on('error', (e: NodeJS.ErrnoException) => done({ ok: false, error: `rendezvous socket connect failed: ${e?.code || String(e)}` }))
    c.on('close', () => done({ ok: false, error: 'rendezvous connection closed before the prompt was confirmed accepted' }))
    c.on('connect', () => c.write(JSON.stringify({ type: 'reply', text }) + '\n' + JSON.stringify({ type: 'repaint' }) + '\n'))
    c.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1)
        if (!line) continue
        let type: string | undefined
        try { type = JSON.parse(line)?.type } catch { continue }   // ignore any non-JSON noise on the wire
        if (type === 'reply-rejected') return done({ ok: false, error: 'agent REJECTED the prompt (rendezvous reply-rejected — auth-gated daemon?)' })
        if (type === 'shutting-down') return done({ ok: false, error: 'agent is shutting down — prompt not accepted' })
        if (type === 'repaint-done') return done({ ok: true })   // reply was enqueued in-order before this
        // heartbeat / state / other frames → keep waiting for the decisive repaint-done or a rejection.
      }
    })
  })
}
// claude's deliver: fail loud BEFORE attempting the socket if it isn't there (a clearer message than a raw
// connect error), exactly as the old sendKeys did, then inject + confirm via the rendezvous round-trip.
function deliverViaRendezvous(id: string, text: string): Promise<DispatchResult> {
  const sock = rvSock(id)
  if (!existsSync(sock)) return Promise.resolve({ ok: false, error: `no rendezvous control socket for session ${id} (socketless/old session, or the agent is offline) — prompt NOT delivered` })
  return replyViaSocket(sock, text)
}

type JsonRpc = { id?: number; method?: string; params?: unknown; result?: unknown; error?: { code?: number; message?: string } }

// The JSON-RPC the delivery handshake speaks, in send order. Method names + param shapes are pinned to codex
// 0.142.3 (`codex app-server generate-ts` → ClientRequest.ts / v2/*Params.ts): the visible TUI is launched with
// `codex --remote unix://<sock>`, so its thread is ALREADY loaded in this server — we must NOT `thread/resume`
// it (that re-loads a thread the live TUI already owns). Instead `thread/loaded/list` PROVES the captured thread
// is the one the pane is showing, then `thread/read{includeTurns}` reveals whether a turn is in progress (and
// its id). The 4th, injecting message is CHOSEN from that read — see codexInjectMessage.
const codexTextInput = (text: string) => [{ type: 'text', text, text_elements: [] }]
export function codexHandshakeMessages(threadId: string): JsonRpc[] {
  return [
    {
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'spexcode', title: 'SpexCode', version: '0.0.0' },
        capabilities: { experimentalApi: true, requestAttestation: false },
      },
    },
    { method: 'initialized', params: {} },
    { id: 2, method: 'thread/loaded/list', params: {} },
    { id: 3, method: 'thread/read', params: { threadId, includeTurns: true } },
  ]
}

// the message that injects `text`. STEER (turn/steer) when an active turn id is known — codex processes it
// WITHOUT waiting for the current turn to end (the human's "工具调用完就插入": injected the moment the running
// tool call returns), so a busy agent reacts mid-turn instead of queuing the message for after it stops.
// `TurnSteerParams` REQUIRES the live turn id as `expectedTurnId` (the server rejects a stale one) — so this is
// only sent with a turnId read live from the thread, never from SpexCode's session status. When the thread is
// idle (no active turn id), START a fresh turn (turn/start). `id` is parameterized so a steer that loses the
// expectedTurnId race (turn ended in the read→steer window) can retry as a turn/start with id 5.
export function codexInjectMessage(threadId: string, text: string, cwd: string | undefined, activeTurnId: string | null, id = 4): JsonRpc {
  if (activeTurnId)
    return { id, method: 'turn/steer', params: { threadId, input: codexTextInput(text), expectedTurnId: activeTurnId } }
  return { id, method: 'turn/start', params: { threadId, input: codexTextInput(text), ...(cwd ? { cwd } : {}) } }
}

// the in-progress turn id from a `thread/read{includeTurns}` result, or null when the thread is idle. With
// includeTurns the Thread carries its turns, each with a TurnStatus ("completed"|"interrupted"|"failed"|
// "inProgress"); the live turn is the `inProgress` one and its id is exactly what turn/steer's precondition needs.
export function activeTurnIdFromThread(readResult: unknown): string | null {
  const thread = (readResult as { thread?: { turns?: Array<{ id?: string; status?: string }> } })?.thread
  const turns = Array.isArray(thread?.turns) ? thread.turns : []
  const active = turns.find((t) => t?.status === 'inProgress')
  return active?.id ?? null
}

export function codexLaunchCommand(_id: string, codexCmd = process.env.SPEXCODE_CODEX_CMD || 'codex --yolo', serverCmd = process.env.SPEXCODE_CODEX_SERVER_CMD || 'codex', dir = process.env.SPEXCODE_CODEX_SOCKET_DIR || runtimeRoot()): string {
  const sock = codexAppServerSock(dir)
  const pid = codexAppServerPid(dir)
  const log = join(dir, 'codex-app-server.log')
  const lock = join(dir, 'codex-app-server.lock')
  const script = [
    `dir=${shQuote(dir)}`,
    `sock=${shQuote(sock)}`,
    `pid=${shQuote(pid)}`,
    `log=${shQuote(log)}`,
    `lock=${shQuote(lock)}`,
    'mkdir -p "$dir"',
    '(',
    '  flock 9',
    '  if [ -S "$sock" ] && [ -s "$pid" ] && ! kill -0 "$(cat "$pid")" 2>/dev/null; then rm -f "$sock"; fi',
    '  if [ ! -S "$sock" ]; then',
    // 9>&- : do NOT let the long-lived app-server inherit fd 9 (the flock fd). An flock is held until
    // EVERY fd on its open file description is closed; if the daemon keeps fd 9 open it pins the lock
    // forever, so every later launcher blocks on `flock 9` and never reaches the thread-owning step
    // (the pane stays at the shell, no TUI, no thread). </dev/null detaches its stdin from the pane so
    // it can't fight the TUI for the tty.
    `    ${serverCmd} app-server --listen unix://"$sock" >"$log" 2>&1 9>&- </dev/null &`,
    '    echo $! > "$pid"',
    '    for i in $(seq 1 100); do [ -S "$sock" ] && break; sleep 0.05; done',
    '  fi',
    ') 9>"$lock"',
    // TWO launch modes, on ONE tail channel ("$@"). reopen() hands a `--resume <thread-id>` tail (see
    // codexHarness.resumeArg) to bring the SAME conversation back: resume that OWNED thread DIRECTLY — no new
    // thread, no first-turn prompt. ANY other tail is a NEW launch: BACKEND owns the thread — `codex-launch`
    // does thread/start { cwd = this worktree } on the shared per-project app-server, stores the new id on the
    // governed record (SPEXCODE_SESSION_ID), and fires the tail as the FIRST turn, materializing the rollout.
    // Either way it ends with a thread id, which the visible TUI then RESUMES (the rollout persists on disk),
    // rendering it natively. A new launch's tail is always ONE single-quoted prompt arg, so it can never be the
    // literal "--resume" marker — the discriminator is unambiguous.
    `if [ "$1" = "--resume" ]; then`,
    `  tid=$2`,
    `else`,
    `  tid=$(${SPEX} codex-launch "$sock" "$PWD" "$@")`,
    `fi`,
    `exec ${codexCmd} --remote unix://"$sock" resume "$tid"`,
  ].join('\n')
  return `bash -lc ${shQuote(script)} spexcode-codex`
}

function rpcError(e: unknown): string {
  return String((e as Error)?.message || e)
}

// --- minimal RFC6455 client framing ------------------------------------------------------------------------
// The codex app-server `--listen unix://<sock>` transport is a WebSocket endpoint at path `/rpc` (the visible
// `codex --remote` TUI upgrades the very same way). So we speak WebSocket over the Unix socket — NOT a raw byte
// stream, and NOT `codex app-server proxy` (a dumb byte relay that performs no HTTP upgrade, so the server
// rejects its bytes as an invalid upgrade and closes — the old 502). One JSON-RPC message = one masked text
// frame; the server's frames come back unmasked. We only ever exchange small frames, so this is deliberately
// small: text + the control frames (ping→pong, close) we must honor, plus continuation reassembly for safety.
function encodeWsFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length
  const mask = randomBytes(4)
  let header: Buffer
  if (len < 126) header = Buffer.from([0x80 | opcode, 0x80 | len])
  else if (len < 65536) header = Buffer.from([0x80 | opcode, 0x80 | 126, (len >> 8) & 0xff, len & 0xff])
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2) }
  const masked = Buffer.alloc(len)
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4]
  return Buffer.concat([header, mask, masked])
}
const wsText = (s: string) => encodeWsFrame(0x1, Buffer.from(s, 'utf8'))

// Decode the unmasked server→client frames accumulated in `buf`, handing each complete text message to
// `onText`; honors ping→pong and a close. Shared by every app-server WS client here. Returns the (possibly
// shrunk) buffer + whether a close was seen, plus the running fragment state threaded back in on each call.
type FrameState = { buf: Buffer; fragOp: number; fragBuf: Buffer }
function drainWsFrames(s: FrameState, conn: Socket, onText: (json: string) => void): boolean {
  for (;;) {
    if (s.buf.length < 2) return false
    const b0 = s.buf[0], b1 = s.buf[1], op = b0 & 0x0f, fin = (b0 & 0x80) !== 0, masked = (b1 & 0x80) !== 0
    let len = b1 & 0x7f, off = 2
    if (len === 126) { if (s.buf.length < 4) return false; len = s.buf.readUInt16BE(2); off = 4 }
    else if (len === 127) { if (s.buf.length < 10) return false; len = Number(s.buf.readBigUInt64BE(2)); off = 10 }
    const dataStart = off + (masked ? 4 : 0)
    if (s.buf.length < dataStart + len) return false
    let payload = s.buf.slice(dataStart, dataStart + len)
    if (masked) { const mk = s.buf.slice(off, off + 4); const u = Buffer.alloc(len); for (let i = 0; i < len; i++) u[i] = payload[i] ^ mk[i % 4]; payload = u }
    s.buf = s.buf.slice(dataStart + len)
    if (op === 0x8) return true                                       // close
    if (op === 0x9) { conn.write(encodeWsFrame(0xa, payload)); continue }   // ping → pong
    if (op === 0xa) continue                                          // pong
    if (op === 0x0) s.fragBuf = Buffer.concat([s.fragBuf, payload])   // continuation
    else { s.fragOp = op; s.fragBuf = payload }
    if (fin) { if (s.fragOp === 0x1) onText(s.fragBuf.toString('utf8')); s.fragBuf = Buffer.alloc(0); s.fragOp = 0 }
  }
}
const WS_UPGRADE = (key: string) => `GET /rpc HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`
const wsInitialize: JsonRpc = { id: 1, method: 'initialize', params: { clientInfo: { name: 'spexcode', title: 'SpexCode', version: '0.0.0' }, capabilities: { experimentalApi: true, requestAttestation: false } } }

// Read a loaded thread id off the app-server via `thread/loaded/list`. With the backend now OWNING the thread
// id at launch (codexStartThread → stored on the record), this is only the DELIVERY FALLBACK for a pre-existing
// session whose id was never stored: it returns the first loaded thread. On a shared per-project server several
// threads may be loaded, so it is no longer the deterministic capture path — the stored id is. Never throws.
export function codexThreadId(sock: string): Promise<{ ok: true; threadId: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const conn: Socket = createConnection(sock)
    const fs: FrameState = { buf: Buffer.alloc(0), fragOp: 0, fragBuf: Buffer.alloc(0) }
    let upgraded = false, settled = false
    const done = (r: { ok: true; threadId: string } | { ok: false; error: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { conn.destroy() } catch { /* */ }
      resolve(r)
    }
    const timer = setTimeout(() => done({ ok: false, error: 'codex app-server did not list threads within 5000ms' }), 5000)
    conn.on('error', (e) => done({ ok: false, error: `codex app-server connection failed: ${rpcError(e)}` }))
    conn.on('close', () => done({ ok: false, error: 'codex app-server closed before thread/loaded/list was answered' }))
    const send = (m: JsonRpc) => conn.write(wsText(JSON.stringify(m)))
    conn.on('connect', () => conn.write(WS_UPGRADE(randomBytes(16).toString('base64'))))
    const handle = (json: string) => {
      let m: JsonRpc
      try { m = JSON.parse(json) } catch { return }
      if (m.error) return done({ ok: false, error: `codex app-server ${m.id ? `request ${m.id}` : 'notification'} failed: ${m.error.message || JSON.stringify(m.error)}` })
      if (m.id === 1 && m.result) { send({ method: 'initialized', params: {} }); return send({ id: 2, method: 'thread/loaded/list', params: {} }) }
      if (m.id === 2 && m.result) {
        const data = (m.result as { data?: unknown }).data
        const ids = Array.isArray(data) ? data.filter((x): x is string => typeof x === 'string') : []
        return ids.length ? done({ ok: true, threadId: ids[0] }) : done({ ok: false, error: 'no loaded thread on the app-server socket yet (TUI still booting?)' })
      }
    }
    conn.on('data', (chunk: Buffer) => {
      fs.buf = Buffer.concat([fs.buf, chunk])
      if (!upgraded) {
        const i = fs.buf.indexOf('\r\n\r\n')
        if (i < 0) return
        const head = fs.buf.slice(0, i).toString('utf8')
        if (!/^HTTP\/1\.1 101/.test(head)) return done({ ok: false, error: `codex app-server refused the WebSocket upgrade: ${head.split('\r\n')[0]}` })
        upgraded = true
        fs.buf = fs.buf.slice(i + 4)
        send(wsInitialize)
      }
      if (drainWsFrames(fs, conn, handle)) done({ ok: false, error: 'codex app-server sent a WebSocket close before thread/loaded/list was confirmed' })
    })
  })
}

// @@@ codexStartThread - the BACKEND owns the thread. On the shared PER-PROJECT app-server we `thread/start
// { cwd }` (codex resolves config/hooks/AGENTS.md from that worktree cwd — exactly as claude loads CLAUDE.md
// per-worktree — so one project-scoped server behaves analogously to a per-worktree launch), and the result
// carries the new thread id (`result.thread.id`). The launcher stores that id on the governed record and
// fires the first turn; there is no capture hook and no rollout/cwd scan. Same WS framing as codexThreadId.
// Never throws.
export function codexStartThread(sock: string, cwd?: string): Promise<{ ok: true; threadId: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const conn: Socket = createConnection(sock)
    const fs: FrameState = { buf: Buffer.alloc(0), fragOp: 0, fragBuf: Buffer.alloc(0) }
    let upgraded = false, settled = false
    const done = (r: { ok: true; threadId: string } | { ok: false; error: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { conn.destroy() } catch { /* */ }
      resolve(r)
    }
    const timer = setTimeout(() => done({ ok: false, error: 'codex app-server did not start a thread within 15000ms' }), 15000)
    conn.on('error', (e) => done({ ok: false, error: `codex app-server connection failed: ${rpcError(e)}` }))
    conn.on('close', () => done({ ok: false, error: 'codex app-server closed before thread/start was answered' }))
    const send = (m: JsonRpc) => conn.write(wsText(JSON.stringify(m)))
    conn.on('connect', () => conn.write(WS_UPGRADE(randomBytes(16).toString('base64'))))
    const handle = (json: string) => {
      let m: JsonRpc
      try { m = JSON.parse(json) } catch { return }
      if (m.error) return done({ ok: false, error: `codex app-server ${m.id ? `request ${m.id}` : 'notification'} failed: ${m.error.message || JSON.stringify(m.error)}` })
      if (m.id === 1 && m.result) { send({ method: 'initialized', params: {} }); return send({ id: 2, method: 'thread/start', params: cwd ? { cwd } : {} }) }
      if (m.id === 2 && m.result) {
        const tid = (m.result as { thread?: { id?: string } })?.thread?.id
        return tid ? done({ ok: true, threadId: tid }) : done({ ok: false, error: 'codex thread/start returned no thread id' })
      }
    }
    conn.on('data', (chunk: Buffer) => {
      fs.buf = Buffer.concat([fs.buf, chunk])
      if (!upgraded) {
        const i = fs.buf.indexOf('\r\n\r\n')
        if (i < 0) return
        const head = fs.buf.slice(0, i).toString('utf8')
        if (!/^HTTP\/1\.1 101/.test(head)) return done({ ok: false, error: `codex app-server refused the WebSocket upgrade: ${head.split('\r\n')[0]}` })
        upgraded = true
        fs.buf = fs.buf.slice(i + 4)
        send(wsInitialize)
      }
      if (drainWsFrames(fs, conn, handle)) done({ ok: false, error: 'codex app-server sent a WebSocket close before thread/start was confirmed' })
    })
  })
}

function sendCodexAppServerTurn(sock: string, threadId: string, text: string, cwd?: string): Promise<DispatchResult> {
  return new Promise((resolve) => {
    const conn: Socket = createConnection(sock)
    const hs = codexHandshakeMessages(threadId)   // [initialize(1), initialized, thread/loaded/list(2), thread/read(3)]
    let buf = Buffer.alloc(0), upgraded = false, settled = false
    let fragOp = 0, fragBuf = Buffer.alloc(0)
    let steering = false   // the id-4 message we sent was a steer → an expectedTurnId race may retry as start(5)
    const done = (r: DispatchResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { conn.destroy() } catch { /* */ }
      resolve(r)
    }
    const timer = setTimeout(() => done({ ok: false, error: 'codex app-server did not confirm the turn within 5000ms' }), 5000)
    conn.on('error', (e) => done({ ok: false, error: `codex app-server connection failed: ${rpcError(e)}` }))
    conn.on('close', () => done({ ok: false, error: 'codex app-server closed the connection before the turn was confirmed' }))
    const send = (m: JsonRpc) => conn.write(wsText(JSON.stringify(m)))
    conn.on('connect', () => {
      const key = randomBytes(16).toString('base64')
      conn.write(`GET /rpc HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`)
    })
    const handle = (json: string) => {
      let m: JsonRpc
      try { m = JSON.parse(json) } catch { return }
      if (m.error) {
        if (m.id === 4 && steering)                                         // active turn ended in the read→steer window → just start a fresh turn
          return send(codexInjectMessage(threadId, text, cwd, null, 5))
        if (m.id === 3)                                                     // thread not readable yet (a freshly-started thread is "not materialized
          return send(codexInjectMessage(threadId, text, cwd, null, 5))     // before its first user message") → no in-progress turn possible, so just turn/start
        return done({ ok: false, error: `codex app-server ${m.id ? `request ${m.id}` : 'notification'} failed: ${m.error.message || JSON.stringify(m.error)}` })
      }
      if (m.id === 1 && m.result) return send(hs[2])                       // initialize ack → ask which threads are loaded
      if (m.id === 2 && m.result) {                                         // loaded-thread list → confirm OUR thread is live, then read it
        const loaded = (m.result as { data?: unknown })?.data
        if (Array.isArray(loaded) && !loaded.includes(threadId))
          return done({ ok: false, error: `Codex thread ${threadId} is not loaded in the app-server (loaded: ${loaded.join(', ') || 'none'}) — prompt NOT delivered` })
        return send(hs[3])                                                 // thread is live → read it to decide steer-vs-start
      }
      if (m.id === 3 && m.result) {                                        // thread read → in-progress turn? steer into it; else start a new one
        const turnId = activeTurnIdFromThread(m.result)
        steering = !!turnId
        return send(codexInjectMessage(threadId, text, cwd, turnId))      // id 4: turn/steer the live turn, or turn/start
      }
      if ((m.id === 4 || m.id === 5) && m.result) return done({ ok: true }) // steer/start accepted → the model has the message
    }
    const drainFrames = () => {
      for (;;) {
        if (buf.length < 2) return
        const b0 = buf[0], b1 = buf[1], op = b0 & 0x0f, fin = (b0 & 0x80) !== 0, masked = (b1 & 0x80) !== 0
        let len = b1 & 0x7f, off = 2
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
        const dataStart = off + (masked ? 4 : 0)
        if (buf.length < dataStart + len) return
        let payload = buf.slice(dataStart, dataStart + len)
        if (masked) { const mk = buf.slice(off, off + 4); const u = Buffer.alloc(len); for (let i = 0; i < len; i++) u[i] = payload[i] ^ mk[i % 4]; payload = u }
        buf = buf.slice(dataStart + len)
        if (op === 0x8) return done({ ok: false, error: 'codex app-server sent a WebSocket close before turn/start was confirmed' })
        if (op === 0x9) { conn.write(encodeWsFrame(0xa, payload)); continue }   // ping → pong
        if (op === 0xa) continue                                                // pong
        if (op === 0x0) fragBuf = Buffer.concat([fragBuf, payload])             // continuation
        else { fragOp = op; fragBuf = payload }
        if (fin) { if (fragOp === 0x1) handle(fragBuf.toString('utf8')); fragBuf = Buffer.alloc(0); fragOp = 0 }
      }
    }
    conn.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      if (!upgraded) {
        const i = buf.indexOf('\r\n\r\n')
        if (i < 0) return
        const head = buf.slice(0, i).toString('utf8')
        if (!/^HTTP\/1\.1 101/.test(head)) return done({ ok: false, error: `codex app-server refused the WebSocket upgrade: ${head.split('\r\n')[0]}` })
        upgraded = true
        buf = buf.slice(i + 4)
        send(hs[0]); send(hs[1])   // initialize + the initialized notification; loaded/list → read → inject follow on the acks
      }
      drainFrames()
    })
  })
}

// fire a turn on an owned thread over the per-project socket — the same steer-vs-start delivery the live UI
// uses. The launcher calls this to materialize a freshly-started thread's rollout (the first turn = the launch
// prompt), and delivery reuses it for follow-ups. Exported so the CLI's `codex-launch` can fire the first turn.
export function codexTurn(sock: string, threadId: string, text: string, cwd?: string): Promise<DispatchResult> {
  return sendCodexAppServerTurn(sock, threadId, text, cwd)
}

// codex's deliver: use the Codex app-server JSON-RPC channel that also powers rich clients, never TUI typing.
// The visible TUI is launched against the same project app-server Unix socket, so this injects into the same
// thread the pane is showing — steering an in-progress turn or starting one if idle. A missing captured thread
// id or socket is a loud failure; there is no tmux send-keys fallback because that reports "typed", not "accepted".
const pexec = promisify(execFile)
const TMUX_SOCK = process.env.SPEXCODE_TMUX || 'spexcode'
async function deliverViaCodexAppServer(rec: HarnessDeliveryRecord, text: string): Promise<DispatchResult> {
  // the socket is PER-PROJECT (the runtime root), shared by every worktree's thread; the owned thread id on
  // the record picks out THIS session's thread.
  const sock = codexAppServerSock(rec.runtimeDir)
  if (!existsSync(sock)) return { ok: false, error: `no Codex app-server socket for this project — prompt NOT delivered` }
  // use the backend-owned thread id stored at launch; fall back to reading the one loaded thread only if it's
  // empty (a pre-existing session from before the id was stored).
  let threadId = rec.harnessSessionId
  if (!threadId) {
    const r = await codexThreadId(sock)
    if (!r.ok) return { ok: false, error: `${r.error} — prompt NOT delivered` }
    threadId = r.threadId
  }
  return sendCodexAppServerTurn(sock, threadId, text, rec.worktreePath)
}

// idempotent replace of the content between sentinels; the user's own content above/below is preserved. The
// comment STYLE is a parameter so ONE primitive serves every managed file — HTML for the md contracts
// (CLAUDE.md/AGENTS.md), `#` for .gitignore — instead of a per-file-type writer. Default = HTML (the md case).
export function writeManagedBlock(file: string, body: string, comment: readonly [string, string] = ['<!-- ', ' -->']): void {
  const [open, close] = comment
  const START = `${open}spexcode:start${close}`
  const END = `${open}spexcode:end${close}`
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = `${START}\n${body}\n${END}`
  let cur = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const re = new RegExp(`${esc(START)}[\\s\\S]*?${esc(END)}`)
  if (re.test(cur)) cur = cur.replace(re, block)
  else cur = cur.trim() ? `${cur.replace(/\n*$/, '')}\n\n${block}\n` : `${block}\n`
  writeFileSync(file, cur)
}

// the shim for one harness: every event → `SPEX='…' bash <dispatch> <harnessId> <Event>`. The harness id is
// baked in so dispatch.sh can export SPEXCODE_HARNESS (the detector for the shell side). SPEX is inherited by
// the cli-needing handlers + the gate's `spex materialize`.
function buildShim(id: HarnessId, events: readonly string[], dispatch: string, spex: string): { json: string; cmd: (e: string) => string } {
  const cmd = (e: string) => `SPEX='${spex}' bash ${dispatch} ${id} ${e}`
  const hooks: Record<string, unknown> = {}
  for (const e of events) hooks[e] = [{ hooks: [{ type: 'command', command: cmd(e) }] }]
  return { json: JSON.stringify({ hooks }, null, 2), cmd }
}

// ---------------------------------------------------------------------------------------------------------
// Codex trust — the codex-rs trusted_hash, reverse-engineered + pinned. Lives in the Codex adapter (it is a
// codex-only fact); Claude has no analog.

// Codex trust keys + the hash use snake_case event labels (codex hook_event_key_label).
const SNAKE: Record<string, string> = {
  SessionStart: 'session_start', UserPromptSubmit: 'user_prompt_submit', PreToolUse: 'pre_tool_use',
  PostToolUse: 'post_tool_use', Stop: 'stop',
}

// @@@ codexHookHash - the trusted_hash codex computes (from codex-rs: command_hook_hash + version_for_toml):
// sha256 of the canonical (recursively key-sorted, compact) JSON of {event_name, hooks:[{type,command,timeout,
// async}]}; None fields omitted. Verified against live codex 0.142.3 samples.
export function codexHookHash(snakeEvent: string, command: string, timeout = 600, asyncFlag = false): string {
  const canon = (v: unknown): unknown =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
      : Array.isArray(v) ? v.map(canon) : v
  const obj = { event_name: snakeEvent, hooks: [{ type: 'command', command, timeout, async: asyncFlag }] }
  return 'sha256:' + createHash('sha256').update(JSON.stringify(canon(obj))).digest('hex')
}

// additively stamp directory + per-hook trust into the user's GLOBAL ~/.codex/config.toml so a user-self-
// launched codex skips the trust prompts. Scoped to THIS project path; replaces our own prior block (between
// sentinels) idempotently; never touches the user's other config. CODEX_HOME respected for testability.
function writeCodexTrust(proj: string, events: readonly string[], cmdFor: (e: string) => string): void {
  const home = process.env.CODEX_HOME || join(homedir(), '.codex')
  const file = join(home, 'config.toml')
  const hooksJson = join(proj, '.codex', 'hooks.json')
  const lines = [`[projects."${proj}"]`, 'trust_level = "trusted"']
  for (const e of events) {
    const snake = SNAKE[e]
    lines.push(`[hooks.state."${hooksJson}:${snake}:0:0"]`, `trusted_hash = "${codexHookHash(snake, cmdFor(e))}"`)
  }
  const blk = `# spexcode:trust:${proj} (managed — do not edit)\n${lines.join('\n')}\n# spexcode:trust:end:${proj}`
  const esc = proj.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let cur = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const re = new RegExp(`# spexcode:trust:${esc} \\(managed[\\s\\S]*?# spexcode:trust:end:${esc}`)
  if (re.test(cur)) cur = cur.replace(re, blk)
  else cur = cur.trim() ? `${cur.replace(/\n*$/, '')}\n\n${blk}\n` : `${blk}\n`
  if (!existsSync(home)) mkdirSync(home, { recursive: true })
  writeFileSync(file, cur)
}

// ---------------------------------------------------------------------------------------------------------
// the two implementations.

const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'StopFailure', 'Notification'] as const
const CODEX_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const

export const claudeHarness: Harness = {
  id: 'claude',
  events: CLAUDE_EVENTS,
  ownsRendezvous: true,                              // reclaude opens the rendezvous control socket (prompt delivery + liveness)
  paneTitleIsSelfSummary: true,                      // claude writes its live task summary into the OSC pane title → headline derives from it
  launchCmd: () => process.env.SPEXCODE_CLAUDE_CMD || 'claude --dangerously-skip-permissions',
  sessionIdArg: (id) => `--session-id ${id}`,        // the caller chooses the id
  sessionEnvVar: 'CLAUDE_CODE_SESSION_ID',
  shimFile: (proj) => join(proj, '.claude', 'settings.json'),
  contractFiles: (proj) => [join(proj, 'CLAUDE.md')],
  skillDir: (proj) => join(proj, '.claude', 'skills'),
  shim: (dispatch, spex) => buildShim('claude', CLAUDE_EVENTS, dispatch, spex),
  writeTrust: () => { /* Claude relies on folder-trust — nothing to write */ },
  slashCommands: claudeSlashCommands,
  liveness: (rec, tmuxAlive) => (tmuxAlive && existsSync(rvSock(rec.session)) ? 'online' : 'offline'),
  deliver: (rec, text) => deliverViaRendezvous(rec.session, text),
  resumeArg: (rec) => `--resume ${rec.session}`,
}

export const codexHarness: Harness = {
  id: 'codex',
  events: CODEX_EVENTS,
  ownsRendezvous: false,                             // no reclaude daemon — liveness + prompts through the project app-server socket
  paneTitleIsSelfSummary: false,                     // codex's pane title is a spinner + the cwd folder name, NOT a task summary → headline uses the prompt
  launchCmd: (id, runtimeDir) => codexLaunchCommand(id, undefined, undefined, runtimeDir ?? runtimeRoot()),   // ONE app-server per PROJECT
  sessionIdArg: () => '',                            // codex assigns its own id (the backend owns it via thread/start)
  sessionEnvVar: 'CODEX_THREAD_ID',
  // Codex discovers a LINKED worktree's PROJECT hooks from the ROOT CHECKOUT's `.codex`, NOT the worktree's
  // (codex-rs `root_checkout_hooks_folder_for_dir` rewrites the hooks-config folder to <repo_root>/<rel>/.codex
  // for any linked worktree). Every worktree's thread (cwd = worktree root) therefore reads the SAME
  // <mainCheckout>/.codex/hooks.json — so the codex hooks shim + its trust materialize at the MAIN checkout
  // (one per project, mirroring the per-project runtime tier), while the AGENTS.md contract + skills stay
  // per-worktree (codex loads THOSE by walking the thread cwd). dispatch.sh resolves `proj` from the thread
  // cwd, so one shared shim serves every worktree.
  shimFile: (proj) => join(mainCheckout(proj), '.codex', 'hooks.json'),
  contractFiles: (proj) => [join(proj, 'AGENTS.md')],
  skillDir: (proj) => join(proj, '.codex', 'skills'),
  shim: (dispatch, spex) => buildShim('codex', CODEX_EVENTS, dispatch, spex),
  writeTrust: (proj, cmdFor) => writeCodexTrust(mainCheckout(proj), CODEX_EVENTS, cmdFor),
  slashCommands: codexSlashCommands,
  liveness: (rec, tmuxAlive, runtimeDir) => (tmuxAlive && existsSync(codexAppServerSock(runtimeDir)) ? 'online' : 'offline'),
  deliver: (rec, text) => deliverViaCodexAppServer(rec, text),
  // owned thread id → `--resume <id>` MARKER the codex launch script reads to resume that thread DIRECTLY (NOT
  // a tail handed to a bare `codex` — the script's final `codex … resume "$tid"` performs codex's own resume on
  // the owned id, the SAME conversation); none → empty tail → relaunch a FRESH thread on the same worktree/record.
  resumeArg: (rec) => (rec.harnessSessionId ? `--resume ${rec.harnessSessionId}` : ''),
}

// every adapter — materialize iterates this to render each harness's artifacts in one pass.
export const HARNESSES: readonly Harness[] = [claudeHarness, codexHarness]

// the harness the dashboard/CLI launcher drives today (Claude). The single place a future codex launcher
// would flip; product code reads this rather than naming Claude.
export const defaultHarness: Harness = claudeHarness

// resolve an adapter by id (the detector). Throws on an unknown id — fail loud, never silently default.
export function harnessById(id: string): Harness {
  const h = HARNESSES.find((x) => x.id === id)
  if (!h) throw new Error(`unknown harness '${id}' (known: ${HARNESSES.map((x) => x.id).join(', ')})`)
  return h
}
