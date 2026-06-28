import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { createHash, randomBytes } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { claudeSlashCommands, codexSlashCommands, type SlashCommand } from './slash-commands.js'

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
  // Codex lacks StopFailure + Notification, so it never sees those.
  readonly events: readonly string[]
  // whether the harness's agent opens a reclaude rendezvous control socket. Claude does; Codex has no such
  // daemon and uses its app-server JSON-RPC control plane instead.
  readonly ownsRendezvous: boolean

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
  // codex: online iff the tmux window is up, its project-scoped app-server socket exists, AND its native
  // thread id has been captured; the socket is a project control plane, not session identity.
  liveness(rec: HarnessLivenessRecord, tmuxAlive: boolean, runtimeDir?: string): 'online' | 'offline'
  // deliver a follow-up prompt to a LIVE session and report whether it landed. claude: through the rendezvous
  // control socket, which injects + submits the prompt and CONFIRMS the daemon accepted it (loud failure on a
  // missing/dead socket — never a silent degradation). codex: JSON-RPC `turn/start` on the same app-server
  // socket the visible TUI uses. Returns ok=false with a reason that propagates to the API.
  deliver(rec: HarnessDeliveryRecord, text: string): Promise<DispatchResult>
  // the relaunch tail reopen() hands launch() to bring the SAME work back up. claude resumes the same
  // conversation (`--resume <id>`, the id we pinned at launch). codex's own thread id is un-pinnable and the
  // spexcode id is NOT a codex flag, so the MVP relaunches FRESH (empty tail → a new codex turn in the same
  // worktree/record); once codex's real thread id is captured this becomes `resume <thread-id>`.
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
// 0.142.3 (`codex app-server generate-ts`): the visible TUI is launched with `codex --remote unix://<sock>`, so
// its thread is ALREADY loaded in this server — we must NOT `thread/resume` it (that re-loads a thread the live
// TUI already owns). Instead we `thread/loaded/list` to PROVE the captured thread is the one the pane is showing,
// then `turn/start` to inject the user message into that live thread (the model processes it as a real turn).
export function codexAppServerTurnMessages(threadId: string, text: string, cwd?: string): JsonRpc[] {
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
    {
      id: 3,
      method: 'turn/start',
      params: {
        threadId,
        input: [{ type: 'text', text, text_elements: [] }],
        ...(cwd ? { cwd } : {}),
      },
    },
  ]
}

export function codexLaunchCommand(_id: string, codexCmd = process.env.SPEXCODE_CODEX_CMD || 'codex --yolo', serverCmd = process.env.SPEXCODE_CODEX_SERVER_CMD || 'codex', dir = process.env.SPEXCODE_CODEX_SOCKET_DIR || tmpdir()): string {
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
    `    ${serverCmd} app-server --listen unix://"$sock" >"$log" 2>&1 &`,
    '    echo $! > "$pid"',
    '    for i in $(seq 1 100); do [ -S "$sock" ] && break; sleep 0.05; done',
    '  fi',
    ') 9>"$lock"',
    `exec ${codexCmd} --remote unix://"$sock" "$@"`,
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

function sendCodexAppServerTurn(sock: string, threadId: string, text: string, cwd?: string): Promise<DispatchResult> {
  return new Promise((resolve) => {
    const conn: Socket = createConnection(sock)
    const msgs = codexAppServerTurnMessages(threadId, text, cwd)   // [initialize(1), initialized, thread/loaded/list(2), turn/start(3)]
    let buf = Buffer.alloc(0), upgraded = false, settled = false
    let fragOp = 0, fragBuf = Buffer.alloc(0)
    const done = (r: DispatchResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { conn.destroy() } catch { /* */ }
      resolve(r)
    }
    const timer = setTimeout(() => done({ ok: false, error: 'codex app-server did not confirm turn/start within 5000ms' }), 5000)
    conn.on('error', (e) => done({ ok: false, error: `codex app-server connection failed: ${rpcError(e)}` }))
    conn.on('close', () => done({ ok: false, error: 'codex app-server closed the connection before turn/start was confirmed' }))
    const send = (m: JsonRpc) => conn.write(wsText(JSON.stringify(m)))
    conn.on('connect', () => {
      const key = randomBytes(16).toString('base64')
      conn.write(`GET /rpc HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`)
    })
    const handle = (json: string) => {
      let m: JsonRpc
      try { m = JSON.parse(json) } catch { return }
      if (m.error) return done({ ok: false, error: `codex app-server ${m.id ? `request ${m.id}` : 'notification'} failed: ${m.error.message || JSON.stringify(m.error)}` })
      if (m.id === 1 && m.result) return send(msgs[2])                       // initialize ack → ask which threads are loaded
      if (m.id === 2 && m.result) {                                         // loaded-thread list → confirm OUR thread is live, then inject
        const loaded = (m.result as { data?: unknown })?.data
        if (Array.isArray(loaded) && !loaded.includes(threadId))
          return done({ ok: false, error: `Codex thread ${threadId} is not loaded in the app-server (loaded: ${loaded.join(', ') || 'none'}) — prompt NOT delivered` })
        return send(msgs[3])                                                // thread is live → start the turn
      }
      if (m.id === 3 && m.result) return done({ ok: true })                 // turn/start accepted → the model is processing the message
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
        send(msgs[0]); send(msgs[1])   // initialize + the initialized notification; resume/turn follow on the ack
      }
      drainFrames()
    })
  })
}

// codex's deliver: use the Codex app-server JSON-RPC channel that also powers rich clients, never TUI typing.
// The visible TUI is launched against the same project app-server Unix socket, so this starts a real turn
// in the same thread the pane is showing. A missing captured thread id or socket is a loud failure; there is no
// tmux send-keys fallback because that reports "typed", not "accepted".
const pexec = promisify(execFile)
const TMUX_SOCK = process.env.SPEXCODE_TMUX || 'spexcode'
async function deliverViaCodexAppServer(rec: HarnessDeliveryRecord, text: string): Promise<DispatchResult> {
  const threadId = rec.harnessSessionId
  if (!threadId) return { ok: false, error: `no captured Codex thread id for session ${rec.session} — prompt NOT delivered` }
  const sock = codexAppServerSock(rec.runtimeDir)
  if (!existsSync(sock)) return { ok: false, error: `no Codex app-server socket for session ${rec.session} — prompt NOT delivered` }
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
  launchCmd: (id, runtimeDir) => codexLaunchCommand(id, undefined, undefined, runtimeDir),
  sessionIdArg: () => '',                            // codex assigns its own id (resumed by a captured id)
  sessionEnvVar: 'CODEX_THREAD_ID',
  shimFile: (proj) => join(proj, '.codex', 'hooks.json'),
  contractFiles: (proj) => [join(proj, 'AGENTS.md')],
  skillDir: (proj) => join(proj, '.codex', 'skills'),
  shim: (dispatch, spex) => buildShim('codex', CODEX_EVENTS, dispatch, spex),
  writeTrust: (proj, cmdFor) => writeCodexTrust(proj, CODEX_EVENTS, cmdFor),
  slashCommands: codexSlashCommands,
  liveness: (rec, tmuxAlive, runtimeDir) => (tmuxAlive && !!rec.harnessSessionId && existsSync(codexAppServerSock(runtimeDir)) ? 'online' : 'offline'),
  deliver: (rec, text) => deliverViaCodexAppServer(rec, text),
  resumeArg: (rec) => (rec.harnessSessionId ? `resume ${rec.harnessSessionId}` : ''),   // captured id → resume; else relaunch FRESH
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
