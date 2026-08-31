import { closeSync, openSync, readSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { createHash, randomBytes } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { parse as parseToml } from 'smol-toml'
import { codexSlashCommands } from './slash-commands.js'
import { runtimeRoot, mainCheckout, readConfig, sessionArtifactPath, spexcodeHome, git, harnessIdentity, HARNESS_IDENTITIES, type HarnessId } from '@spexcode/spec-core'
import { detachedRuntimeGenerationToken, migrateLegacyDetachedRuntimeReceipt, processStartToken, verifyDetachedRuntime, type VerifiedDetachedRuntime } from '@spexcode/spec-core'
import { codexGenerationEndpoints, codexGenerationSocketPath, currentCodexGeneration, legacyCodexGenerationEndpoint, readCodexGenerationLedger, prepareCodexGenerationClose, resolveCodexGenerationForClose, resolveCodexGenerationForResume, resolveCodexGenerationForSession, type CodexGenerationEndpoint } from './codex-runtime-generations.js'
import { spawnDetachedRuntime } from './runtime-ownership.js'
import { codexRolloutPath, codexTranscript } from '@spexcode/transcript'
import { shQuote } from './sh.js'
import { writeFileIfChanged } from './file-write.js'
import type { Harness, HarnessLivenessRecord, HarnessDeliveryRecord, HarnessLaunchReadyRecord, SharedRuntimeDescriptor, SharedRuntimeMutationGuard, SharedRuntimeProbe, HarnessOrphanThreadQuarantine, DispatchResult, PaneProbe, ProcTable, HarnessArtifacts, TurnFailure, FailureSubscription } from './harness.js'


import { buildShim, cleanHarness, headlessTurnFailureShell, listenerAt, noLaunchEnv, paneTreeRuns, procSnapshot, sessionIdentityEnvVars, writeManagedBlock, removeManagedBlock, writeManagedJsonHooks, removeManagedJsonHooks, sharedShimHasHostContent, GENERATED_MARK, isGeneratedArtifact, SPEX } from './harness-shim.js'

const CODEXISH = /^(codex|node)/i
export function paneTreeRunsCodex(pane?: PaneProbe): boolean { return paneTreeRuns(pane, CODEXISH) }


// The app-server Unix socket MUST live on a SHORT, sun_path-safe path — NOT nested under the project runtime
// dir. macOS caps `sun_path` at ~104 bytes, and `runtimeRoot()` flattens the ENTIRE project path into one
// dash-segment (`encodeProject`), so `<runtimeRoot>/codex-app-server.sock` blew past the cap on a deep macOS
// project (~111 chars) → `path must be shorter than SUN_LEN` + connect EINVAL, and the app-server never bound
// (Linux's 108 limit + shorter `/root` paths happened to fit; macOS did not). So the socket is
// `<socketBase>/spexcode-cx-<hash>.sock`, where `<hash>` is a short STABLE digest of the PROJECT identity — the
// `dir` (runtimeDir) the callers pass — so launch, liveness, and delivery all compute the IDENTICAL sock for a
// given project (the ONE-app-server-per-project invariant). This is UNCONDITIONAL on every platform (a short
// hashed path is strictly better everywhere — no darwin branch; platform differences stay at this path seam).
// `<socketBase>` = the `SPEXCODE_CODEX_SOCKET_DIR` override, else an OWNED per-uid subdir of the platform
// tmpdir (`spexcode-cx-<uid>`, created 0700) — NEVER bare tmpdir: codex (0.137+ field-confirmed) refuses to
// bind a unix socket directly in the shared sticky `/tmp` on a host with `fs.protected_regular=2` (EPERM), so
// the bare-tmpdir default failed every codex launch on a stock hardened Ubuntu out of the box (github#30),
// while the SAME codex binds fine in any owned subdirectory. Per-uid (not one shared `spexcode-cx`) so a
// second user on the box never lands in the first user's 0700 dir. The derivation GUARANTEES the dir exists
// (idempotent mkdir) so every consumer — launch bake, liveness connect, delivery, tests — shares one creation
// point. The `.pid`/`.log`/`.lock` files carry no sun_path limit and stay in `runtimeRoot`.
export const codexAppServerSock = (dir = runtimeRoot()) => {
  return codexGenerationSocketPath(dir)
}
export const codexAppServerPid = (dir = runtimeRoot()) => join(dir, 'codex-app-server.pid')
export const codexAppServerReceipt = (dir = runtimeRoot()) => join(dir, 'codex-app-server.detached.json')
const codexAppServerLegacyScope = (dir = runtimeRoot()) => join(dir, 'codex-app-server.scope')
type CodexRuntimeGenerationProof = Readonly<{
  identity: VerifiedDetachedRuntime
  socket: Readonly<{ path: string; dev: number; ino: number }>
}>
function codexRuntimeGenerationProof(dir = runtimeRoot(), endpoint = legacyCodexGenerationEndpoint(dir)): CodexRuntimeGenerationProof | null {
  try {
    const pid = Number(readFileSync(endpoint.pidFile, 'utf8').trim())
    const detached = verifyDetachedRuntime(pid, endpoint.receiptFile)
    const socketPath = endpoint.socketPath
    const socket = statSync(socketPath)
    if (!(pid > 0) || !detached.ok || !socket.isSocket()) return null
    return Object.freeze({
      identity: detached.identity,
      socket: Object.freeze({ path: socketPath, dev: socket.dev, ino: socket.ino }),
    })
  } catch { return null }
}
const codexRuntimeGenerationToken = (proof: CodexRuntimeGenerationProof) =>
  `${detachedRuntimeGenerationToken(proof.identity)}|${proof.socket.path}|${proof.socket.dev}:${proof.socket.ino}`
function codexRuntimeGeneration(dir = runtimeRoot(), endpoint = legacyCodexGenerationEndpoint(dir)): string | null {
  const proof = codexRuntimeGenerationProof(dir, endpoint)
  return proof ? codexRuntimeGenerationToken(proof) : null
}

function codexMutationGeneration(dir = runtimeRoot(), endpoint = legacyCodexGenerationEndpoint(dir)): string | null {
  const current = codexRuntimeGeneration(dir, endpoint)
  if (current) return current
  if (endpoint.id !== 'legacy') return null
  let pid: number
  try {
    pid = Number(readFileSync(codexAppServerPid(dir), 'utf8').trim())
    if (!Number.isInteger(pid) || pid <= 0 || !statSync(codexAppServerSock(dir)).isSocket()) return null
  } catch { return null }
  if (!migrateLegacyDetachedRuntimeReceipt(pid, codexAppServerLegacyScope(dir), codexAppServerReceipt(dir))) return null
  return codexRuntimeGeneration(dir, endpoint)
}

const codexDescriptorKey = (endpoint: CodexGenerationEndpoint) => endpoint.id === 'legacy' ? 'codex-app-server' : `codex-app-server:${endpoint.id}`

function codexEndpointForRecord(rec: HarnessLivenessRecord & { harnessSessionId?: string | null }, dir = runtimeRoot(), includeGone = false): CodexGenerationEndpoint | null {
  if (!rec.harnessSessionId) return null
  const ledger = readCodexGenerationLedger(dir)
  if (ledger.revision === 0 && !ledger.current && !Object.keys(ledger.generations).length) return legacyCodexGenerationEndpoint(dir)
  if (includeGone) return resolveCodexGenerationForClose(dir, rec.session, rec.harnessSessionId)?.endpoint ?? null
  return resolveCodexGenerationForSession(dir, rec.session, rec.harnessSessionId)
}

type JsonRpc = { id?: number; method?: string; params?: unknown; result?: unknown; error?: { code?: number; message?: string } }

// The JSON-RPC the delivery handshake speaks, in send order. Method names + param shapes are pinned to codex
// 0.142.3 (`codex app-server generate-ts` → ClientRequest.ts / v2/*Params.ts): the visible TUI is launched with
// `codex --remote unix://<sock>`, so its thread is ALREADY loaded in this server — we must NOT `thread/resume`
// it (that re-loads a thread the live TUI already owns). Instead `thread/loaded/list` PROVES the captured thread
// is the one the pane is showing. The failure observer owns the active native turn id from app-server
// notifications; delivery does not read the thread or replay its history — see codexInjectMessage.
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
  ]
}

// the message that injects `text`. STEER (turn/steer) when an active turn id is known — codex processes it
// WITHOUT waiting for the current turn to end (the human's "工具调用完就插入": injected the moment the running
// tool call returns), so a busy agent reacts mid-turn instead of queuing the message for after it stops.
// `TurnSteerParams` REQUIRES the live turn id as `expectedTurnId` (the server rejects a stale one) — so this is
// only sent with a turnId read live from the thread, never from SpexCode's session status. When the thread is
// idle (no active turn id), START a fresh turn (turn/start). `id` is parameterized so a steer that loses the
// expectedTurnId race (turn ended in the read→steer window) can retry as a turn/start with id 5.
export function codexInjectMessage(threadId: string, text: string, cwd: string | undefined, activeTurnId: string | null, id = 4, clientUserMessageId?: string): JsonRpc {
  const marker = clientUserMessageId ? { clientUserMessageId } : {}
  if (activeTurnId)
    return { id, method: 'turn/steer', params: { threadId, input: codexTextInput(text), expectedTurnId: activeTurnId, ...marker } }
  return { id, method: 'turn/start', params: { threadId, input: codexTextInput(text), ...(cwd ? { cwd } : {}), ...marker } }
}

// the in-progress turn id from a `thread/read{includeTurns}` result, or null when the thread is idle. This is
// retained for ownership/replay probes; delivery uses codexObservedActiveTurnId because it must not request the
// full history. With
// includeTurns the Thread carries its turns, each with a TurnStatus ("completed"|"interrupted"|"failed"|
// "inProgress"); the live turn is the `inProgress` one and its id is exactly what turn/steer's precondition needs.
export function activeTurnIdFromThread(readResult: unknown): string | null {
  const thread = (readResult as { thread?: { turns?: Array<{ id?: string; status?: string }> } })?.thread
  const turns = Array.isArray(thread?.turns) ? thread.turns : []
  const active = turns.find((t) => t?.status === 'inProgress')
  return active?.id ?? null
}

// The app-server's lightweight thread/read intentionally omits the turn list. Keep the native active id
// observed by the failure subscription so a send can steer without replaying the whole conversation.
const codexActiveTurns = new Map<string, string>()
export function codexObservedActiveTurnId(threadId: string): string | null {
  return codexActiveTurns.get(threadId) || null
}
function rememberCodexActiveTurn(threadId: string, turnId: unknown): void {
  if (typeof turnId === 'string' && turnId) codexActiveTurns.set(threadId, turnId)
}
function forgetCodexActiveTurn(threadId: string, turnId?: unknown): void {
  if (turnId === undefined || codexActiveTurns.get(threadId) === turnId) codexActiveTurns.delete(threadId)
}

// The app-server and the visible `--remote … resume` TUI share ONE socket, so they MUST be the SAME codex
// install — a version split across that socket breaks the thread/start→resume handoff (an app-server on one
// version creates a thread a differently-versioned resume can't find; an old-enough app-server can't serve
// `--remote unix://` at all). So `serverCmd` is DERIVED from the in-effect `codexCmd`'s binary (its first shell
// token, dropping args like `--yolo`) whenever it isn't explicitly forced: `<bin> app-server` then runs the
// SAME install as `<bin> --remote … resume`. Bare `codex` is NOT the default anymore — on a multi-install host
// (e.g. homebrew codex shadowing an nvm codex) a bare `codex` resolves via the login-shell PATH to a DIFFERENT
// binary than the launcher's, which is exactly the version-skew bug. `SPEXCODE_CODEX_SERVER_CMD` stays the
// explicit escape hatch (highest precedence). Caveat: if `codexCmd`'s first token is a WRAPPER script rather
// than codex itself, the derived `<wrapper> app-server` only works if the wrapper forwards to codex — the
// common direct-binary case (`codex …`, `/abs/codex --yolo`) is what this fixes.
export function codexBinary(codexCmd: string): string {
  return codexCmd.trim().split(/\s+/)[0] || 'codex'
}

export type CodexThreadPolicy = {
  approvalPolicy?: 'untrusted' | 'on-request' | 'never'
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
}

const regexEscape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const codexOptionValue = <T extends string>(command: string, flags: readonly string[], values: readonly T[]): T | undefined => {
  const flagPattern = flags.map(regexEscape).join('|')
  const valuePattern = values.map(regexEscape).join('|')
  const matcher = new RegExp(`(?:^|\\s)(?:${flagPattern})(?:=|\\s+)[\"']?(${valuePattern})[\"']?(?=$|\\s)`, 'g')
  let found: T | undefined
  for (const match of command.matchAll(matcher)) found = match[1] as T
  return found
}

// The backend creates the thread before the visible remote TUI, so translate launcher autonomy flags at this
// adapter boundary. A flag on the later resume command cannot change an already-created thread.
export function codexLauncherThreadPolicy(command: string): CodexThreadPolicy {
  if (/(?:^|\s)(?:--yolo|--dangerously-bypass-approvals-and-sandbox)(?=$|\s)/.test(command)) {
    return { approvalPolicy: 'never', sandbox: 'danger-full-access' }
  }
  const approvalPolicy = codexOptionValue(command, ['--ask-for-approval', '-a'], ['untrusted', 'on-request', 'never'] as const)
  const sandbox = codexOptionValue(command, ['--sandbox', '-s'], ['read-only', 'workspace-write', 'danger-full-access'] as const)
  return { ...(approvalPolicy ? { approvalPolicy } : {}), ...(sandbox ? { sandbox } : {}) }
}
// codex >=0.142 adds `--dangerously-bypass-hook-trust` — run our OWN (vetted) dispatch hooks without a persisted
// trusted_hash. We PREFER it over reverse-engineering codexHookHash: that hash is pinned to one codex version's
// format and silently breaks on a bump (codex then skips ALL our hooks -> no Stop gate, no mark-active, sessions
// die undeclared). The flag is version-robust. But an OLDER codex HARD-ERRORS on the unknown flag (the whole
// app-server fails to boot), so we CAPABILITY-PROBE the binary once (`--help` grep) and only pass it when
// present; otherwise the writeCodexTrust hash path still stands in. Memoized — a per-binary constant.
const bypassProbe = new Map<string, boolean>()
export function codexSupportsBypassHookTrust(binary: string): boolean {
  // explicit escape hatch (also what makes this deterministic in tests): force the capability on/off regardless
  // of the binary — e.g. if the `--help` probe is unreliable on a wrapper, or to pin behaviour.
  const env = process.env.SPEXCODE_CODEX_BYPASS_HOOK_TRUST
  if (env !== undefined) return env === '1' || env === 'true'
  const hit = bypassProbe.get(binary)
  if (hit !== undefined) return hit
  let ok = false
  try { ok = execFileSync(binary, ['--help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).includes('--dangerously-bypass-hook-trust') } catch { ok = false }
  bypassProbe.set(binary, ok)
  return ok
}

export function codexLaunchCommand(id: string, codexCmd = 'codex', serverCmd?: string, dir = runtimeRoot(), attachTui = true): string {
  const server = process.env.SPEXCODE_CODEX_SERVER_CMD || serverCmd || codexBinary(codexCmd)
  // The bypass flag ONLY reaches a thread's hook trust as a per-request `config` override, NOT as a CLI flag on
  // the shared `app-server` process (the app-server never reads its own `--dangerously-bypass-hook-trust` for a
  // thread — it was INERT there, the bug). Two thread paths carry it: (1) the BACKEND-owned `thread/start` sends
  // `config.bypass_hook_trust` from codex-launch ([[harness-adapter]]); (2) the visible `--remote … resume` TUI,
  // where codex's OWN client forwards this flag into its thread/start+thread/resume config — so a reopen in a
  // fresh app-server (where codex-launch never runs) still trusts our hooks. Hence the flag lives on the resume
  // TUI, never on the app-server invocation. Guarded against a double-flag when an env override already carries it.
  const tuiBypass = !codexCmd.includes('--dangerously-bypass-hook-trust') && codexSupportsBypassHookTrust(codexBinary(codexCmd)) ? ' --dangerously-bypass-hook-trust' : ''
  const script = [
    `dir=${shQuote(dir)}`,
    // codex-launch's bypass-trust gate (and writeTrust's) resolves the codex binary from SPEXCODE_CODEX_CMD;
    // WE already hold the launcher's real cmd here (it drives the app-server + resume TUI + tuiBypass above), so
    // pin it into the environment the codex-launch child inherits. Without this the child falls back to a bare
    // `codex`, which on a multi-install box (e.g. an old Homebrew codex on PATH beside the launcher's newer one)
    // probes the WRONG binary — deciding "no --dangerously-bypass-hook-trust support" and silently dropping the
    // thread/start bypass, so the worktree's hooks stay untrusted and NO lifecycle hooks fire.
    `export SPEXCODE_CODEX_CMD=${shQuote(codexCmd)}`,
    // The runtime command is the single generation-ledger boundary. A new turn receives canonical `current`;
    // resume resolves its existing session/thread binding, so a LIVE root never has its conversation moved to a
    // replacement. Both spellings carry the server command because either may be the launch that has to start a
    // root: after a host restart the bound generation is a corpse, and resume rebuilds one to load the same
    // on-disk rollout. It prints only shell assignments for the exact proven endpoint.
    'if [ "$1" = "--resume" ]; then',
    `  eval "$( ${SPEX} internal codex-generation-session "$dir" "$SPEXCODE_SESSION_ID" "$2" ${shQuote(server)} )" || exit 1`,
    'else',
  `  eval "$( ${SPEX} internal codex-generation-current "$dir" ${shQuote(server)} )" || exit 1`,
    'fi',
    // TWO launch modes, on ONE tail channel ("$@"). reopen() hands a `--resume <thread-id>` tail (see
    // codexHarness.resumeArg) to bring the SAME conversation back: resume that OWNED thread DIRECTLY — no new
    // thread, no first-turn prompt. ANY other tail is a NEW launch: BACKEND owns the thread — `codex-launch`
    // does thread/start { cwd = this worktree } on the shared per-project app-server, fires the tail as the
    // FIRST turn, materializes the rollout, and stages the new id + payload proof for the lifecycle owner.
    // Either way it ends with a thread id, which the visible TUI then RESUMES (the rollout persists on disk),
    // rendering it natively. A new launch's tail is always ONE single-quoted prompt arg, so it can never be the
    // literal "--resume" marker — the discriminator is unambiguous. codex-launch only prints an id once its
    // rollout has landed (resume-ready), so a fail-loud (empty output / non-zero) must ABORT — never `resume ""`.
    `if [ "$1" = "--resume" ]; then`,
    `  tid=$2`,
    ...(attachTui ? [] : [
      // A headless resume has no TUI to reload the thread. The shared app-server evicts an idle thread from its
      // loaded set, and headless readiness proves online only for a RESIDENT thread, so resume must reopen it
      // here — the load the visible TUI's `resume "$tid"` would have done — or readiness times out for a thread
      // that is fine on disk. codex-generation-session above already ensured the app-server, so `$sock` is live.
      `  ${SPEX} internal codex-resume "$sock" "$tid" || exit 1`,
      // A headless forced reopen with NO thread id and no prompt has nothing to attach and nothing to launch.
      // Keep it a no-op instead of calling codex-launch without a prompt (which would mint an unrelated thread).
      `elif [ "$#" -eq 0 ]; then`,
      `  exit 0`,
    ]),
    `else`,
    `  tid=$(${SPEX} internal codex-launch "$sock" "$PWD" "$@")`,
    `  __spex_rc=$?`,
    ...(attachTui ? [`  [ "$__spex_rc" -eq 0 ] || exit 1`] : [
      `  if [ "$__spex_rc" -ne 0 ]; then ${headlessTurnFailureShell('codex-headless')}; exit "$__spex_rc"; fi`,
    ]),
    `fi`,
    `[ -n "$tid" ] || { echo "[spex] codex-launch produced no resumable thread" >&2; exit 1; }`,
    // The visible TUI is the OTHER entry point that creates an execution context for this session (a fresh
    // launch attaches to the thread codex-launch just made; a reopen resumes an existing one), so it injects
    // the same per-thread identity through codex's own `-c` override. Same rule, both entry points: whoever
    // creates a context stamps that context's record id, and nothing downstream re-derives it.
    // A remote Codex TUI cannot inherit the launch shell's cwd: when `tui.resume_cwd = "current"` is
    // configured, Codex requires an explicit workspace root for every `--remote` invocation. Keep the
    // directory tied to the generated script's actual pane cwd so linked worktrees with spaces remain one
    // argument and the resumed thread loads the same project context as thread/start above.
    ...(attachTui ? [`exec ${codexCmd}${tuiBypass} -c ${shQuote(`shell_environment_policy.set.SPEXCODE_SESSION_ID=${id}`)} --cd "$PWD" --remote unix://"$sock" resume "$tid"`] : []),
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
function drainWsFrames(s: FrameState, conn: Socket, onText: (json: string) => void, acceptPayload: (payload: Buffer) => boolean = () => true): boolean {
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
    if (fin) {
      if (s.fragOp === 0x1 && acceptPayload(s.fragBuf)) onText(s.fragBuf.toString('utf8'))
      s.fragBuf = Buffer.alloc(0); s.fragOp = 0
    }
  }
}
const WS_UPGRADE = (key: string) => `GET /rpc HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`
const wsInitialize: JsonRpc = { id: 1, method: 'initialize', params: { clientInfo: { name: 'spexcode', title: 'SpexCode', version: '0.0.0' }, capabilities: { experimentalApi: true, requestAttestation: false } } }
// Native Codex can take 15-17s to answer thread/resume under a loaded app-server. A shorter
// deadline creates a retry storm in the session reconciler, not a useful failure signal.
export const CODEX_TURN_OBSERVER_SUBSCRIBE_MS = 30_000

// Codex has no StopFailure hook, but its app-server has the stronger native signal: every subscribed turn ends
// with turn/completed and a final completed/interrupted/failed status. Rejoin is atomic with subscription, so
// this observer also survives backend replacement; a thread already in systemError is reconciled from its
// latest turn before later live notifications take over.
export function codexTurnFailureObserver(
  rec: HarnessDeliveryRecord,
  onFailure: (failure: TurnFailure) => void,
): FailureSubscription {
  const threadId = rec.harnessSessionId
  if (!threadId) return { close: () => {}, closed: Promise.resolve(null) }
  const runtimeDir = rec.runtimeDir || runtimeRoot()
  const endpoint = codexEndpointForRecord(rec, runtimeDir)
  if (!endpoint) {
    return {
      close: () => {},
      closed: Promise.resolve(`Codex turn observer refused: no exact generation binding for session ${rec.session}`),
    }
  }
  const sock = endpoint.socketPath
  const conn: Socket = createConnection(sock)
  const frames: FrameState = { buf: Buffer.alloc(0), fragOp: 0, fragBuf: Buffer.alloc(0) }
  let upgraded = false, settled = false
  let reconciliationTimer: ReturnType<typeof setTimeout> | null = null
  let readySettled = false
  let resolveReady!: (ready: boolean) => void
  const ready = new Promise<boolean>((resolve) => { resolveReady = resolve })
  let resolveClosed!: (reason: string | null) => void
  const closed = new Promise<string | null>((resolve) => { resolveClosed = resolve })
  const cancelReconciliation = () => {
    if (!reconciliationTimer) return
    clearTimeout(reconciliationTimer)
    reconciliationTimer = null
  }
  const finish = (reason: string | null) => {
    if (settled) return
    settled = true
    if (!readySettled) { readySettled = true; resolveReady(false) }
    clearTimeout(timer)
    cancelReconciliation()
    try { conn.destroy() } catch {}
    resolveClosed(reason)
  }
  const timer = setTimeout(() => finish(`Codex turn observer did not subscribe within ${CODEX_TURN_OBSERVER_SUBSCRIBE_MS}ms`), CODEX_TURN_OBSERVER_SUBSCRIBE_MS)
  timer.unref?.()
  const send = (message: JsonRpc) => conn.write(wsText(JSON.stringify(message)))
  const report = (turn: unknown, fallbackMessage?: string) => {
    const value = turn as { status?: unknown; completedAt?: unknown; error?: { message?: unknown } | null }
    if (value?.status !== 'failed' && !fallbackMessage) return
    const nativeMessage = typeof value?.error?.message === 'string' ? value.error.message.trim() : ''
    onFailure({
      message: nativeMessage || fallbackMessage || 'Codex turn failed',
      completedAt: typeof value?.completedAt === 'number' && Number.isFinite(value.completedAt) ? value.completedAt : null,
    })
  }
  conn.on('error', (error) => finish(`Codex turn observer connection failed: ${rpcError(error)}`))
  conn.on('close', () => finish('Codex turn observer connection closed'))
  conn.on('connect', () => conn.write(WS_UPGRADE(randomBytes(16).toString('base64'))))
  const handle = (json: string) => {
    // A resumed Codex thread can stream large goal/progress notifications while the turn runs. They are
    // irrelevant to this failure observer; avoid JSON.parse on those payloads so one active turn cannot make
    // the backend spend its memory and CPU re-materializing a transcript it does not use.
    if (json.includes('"method"') && !json.includes('"method":"turn/started"') && !json.includes('"method":"turn/completed"')) return
    let message: JsonRpc
    try { message = JSON.parse(json) } catch { return }
    if (message.error) return finish(`Codex turn observer request failed: ${message.error.message || JSON.stringify(message.error)}`)
    if (message.id === 1 && message.result) {
      send({ method: 'initialized', params: {} })
      return send({
        id: 2,
        method: 'thread/resume',
        params: { threadId, excludeTurns: true, initialTurnsPage: { limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' } },
      })
    }
    if (message.id === 2 && message.result) {
      clearTimeout(timer)
      if (!readySettled) { readySettled = true; resolveReady(true) }
      const result = message.result as { thread?: { status?: { type?: unknown } }; initialTurnsPage?: { data?: unknown } }
      const initialTurns = result.initialTurnsPage?.data
      const initialActive = Array.isArray(initialTurns)
        ? initialTurns.find((turn) => (turn as { status?: unknown })?.status === 'inProgress')
        : null
      rememberCodexActiveTurn(threadId, (initialActive as { id?: unknown } | null)?.id)
      if (result.thread?.status?.type === 'systemError') {
        const latest = Array.isArray(initialTurns) ? initialTurns[0] : null
        // Give a concurrently-starting turn's native notification precedence over this historical snapshot.
        reconciliationTimer = setTimeout(() => {
          reconciliationTimer = null
          report(latest, 'Codex thread entered systemError before the turn observer subscribed')
        }, 100)
        reconciliationTimer.unref?.()
      }
      return
    }
    if (message.method === 'turn/started') {
      const params = message.params as { threadId?: unknown; turn?: { id?: unknown } } | undefined
      if (params?.threadId === threadId) {
        rememberCodexActiveTurn(threadId, params.turn?.id)
        cancelReconciliation()
      }
    }
    if (message.method === 'turn/completed') {
      const params = message.params as { threadId?: unknown; turn?: unknown } | undefined
      if (params?.threadId === threadId) {
        forgetCodexActiveTurn(threadId, (params.turn as { id?: unknown } | undefined)?.id)
        cancelReconciliation()
        report(params.turn)
      }
    }
  }
  conn.on('data', (chunk: Buffer) => {
    frames.buf = Buffer.concat([frames.buf, chunk])
    if (!upgraded) {
      const split = frames.buf.indexOf('\r\n\r\n')
      if (split < 0) return
      const head = frames.buf.slice(0, split).toString('utf8')
      if (!/^HTTP\/1\.1 101/.test(head)) return finish(`Codex app-server refused turn observer: ${head.split('\r\n')[0]}`)
      upgraded = true
      frames.buf = frames.buf.slice(split + 4)
      send(wsInitialize)
    }
    if (drainWsFrames(frames, conn, handle, (payload) => {
      const method = Buffer.from('"method"')
      return !payload.includes(method) || payload.includes(Buffer.from('"turn/started"')) || payload.includes(Buffer.from('"turn/completed"'))
    })) finish('Codex app-server closed the turn observer')
  })
  return { close: () => finish(null), closed, ready }
}

// Protocol-verified cold/restore/control seam. The Codex schema (`codex app-server generate-json-schema --experimental`)
// defines thread/archive, thread/delete, and thread/unarchive with {threadId}, plus turn/interrupt with {threadId, turnId}; no
// guessed method or process command is used.
type CodexGenerationFence = { dir: string; endpoint: CodexGenerationEndpoint; generation: string }
// A failed mutation says whether the server can still commit it. `refused` means the request never reached the
// server or the server answered by rejecting it, so the target is provably unchanged and compensation is safe.
// `unknown` means the request was sent and no verdict came back — the server may still be executing it, so
// sending anything else down the same connection queues behind that work and fails too.
type CodexMutationOutcome = { ok: true } | { ok: false; error: string; commit: 'refused' | 'unknown' }
function codexThreadMutation(sock: string, method: 'thread/archive' | 'thread/delete' | 'thread/unarchive' | 'turn/interrupt', threadId: string, fence?: CodexGenerationFence, turnId?: string, budgetMs = CODEX_MUTATION_BASE_MS): Promise<CodexMutationOutcome> {
  const generationError = () => fence && codexRuntimeGeneration(fence.dir, fence.endpoint) !== fence.generation
    ? `Codex ${method} refused because the shared app-server generation changed`
    : null
  const before = generationError()
  if (before) return Promise.resolve({ ok: false, error: before, commit: 'refused' })
  if (method === 'turn/interrupt' && !turnId)
    return Promise.resolve({ ok: false, error: 'Codex turn interrupt needs an exact turn id', commit: 'refused' })
  return new Promise((resolve) => {
    const conn: Socket = createConnection(sock)
    const fs: FrameState = { buf: Buffer.alloc(0), fragOp: 0, fragBuf: Buffer.alloc(0) }
    let upgraded = false, settled = false, requested = false
    const done = (r: CodexMutationOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { conn.destroy() } catch {}
      resolve(r)
    }
    // Once the request is on the wire the server owns it, so every unanswered end — timeout, socket error,
    // early close, a generation swap — leaves the commit unknown rather than refused.
    const unanswered = (error: string) => done({ ok: false, error, commit: requested ? 'unknown' : 'refused' })
    const timer = setTimeout(() => unanswered(generationError() || `Codex ${method} did not answer within ${budgetMs}ms`), budgetMs)
    conn.on('error', (e) => unanswered(generationError() || `Codex ${method} connection failed: ${rpcError(e)}`))
    conn.on('close', () => { if (!settled) unanswered(`Codex app-server closed during ${method}`) })
    const send = (m: JsonRpc) => conn.write(wsText(JSON.stringify(m)))
    conn.on('connect', () => {
      const changed = generationError()
      if (changed) return unanswered(changed)
      conn.write(WS_UPGRADE(randomBytes(16).toString('base64')))
    })
    const handle = (json: string) => {
      let m: JsonRpc
      try { m = JSON.parse(json) } catch { return }
      // The server answered by rejecting, so the target is provably unchanged whether or not we had sent it.
      if (m.error) return done({ ok: false, error: generationError() || `Codex ${method} failed: ${m.error.message || JSON.stringify(m.error)}`, commit: 'refused' })
      if (m.id === 1 && m.result) {
        const changed = generationError()
        if (changed) return unanswered(changed)
        send({ method: 'initialized', params: {} })
        requested = true
        return send({ id: 2, method, params: method === 'turn/interrupt' ? { threadId, turnId } : { threadId } })
      }
      if (m.id === 2 && m.result) {
        const changed = generationError()
        return changed ? unanswered(changed) : done({ ok: true })
      }
    }
    conn.on('data', (chunk: Buffer) => {
      fs.buf = Buffer.concat([fs.buf, chunk])
      if (!upgraded) {
        const i = fs.buf.indexOf('\r\n\r\n')
        if (i < 0) return
        const head = fs.buf.slice(0, i).toString('utf8')
        if (!/^HTTP\/1\.1 101/.test(head)) return done({ ok: false, error: `Codex app-server refused WebSocket upgrade for ${method}`, commit: 'refused' })
        upgraded = true
        fs.buf = fs.buf.slice(i + 4)
        send(wsInitialize)
      }
      if (drainWsFrames(fs, conn, handle)) unanswered(`Codex app-server closed during ${method}`)
    })
  })
}

type CodexPagedIdsResult = { ok: true; ids: string[] } | { ok: false; error: string }
// Dashboard/resource probes keep their own short budget; this target-scoped census is only entered by a
// lifecycle mutation that already holds the session transition lock and must tolerate a busy app-server.
const CODEX_MUTATION_CENSUS_MS = 15_000
// A mutation's response budget. `thread/unarchive` and `turn/interrupt` are state flips the server answers at
// once — measured 36ms to unarchive the very same 279 MB thread that took 47.7s to archive — so they keep the
// base. `thread/archive` on a LOADED thread differs in kind: the server flushes that thread's whole in-memory
// rollout inside shutdown_and_wait before it commits, so the wait is proportional to accumulated history
// (measured 47.7s for 279 MB, ~5.9 MB/s, against ~1.5s for a notLoaded member that flushes nothing). A fixed
// ceiling therefore never bounds the operation; it only picks the transcript size above which archive stops
// working, and raising it just moves that size. The scaled term is deliberately pessimistic — a floor rate ~6x
// under the measured one — because its job is to catch a WEDGED server, not to predict a flush: a machine
// several times slower still archives, while a hung one still fails loudly.
const CODEX_MUTATION_BASE_MS = 15_000
const CODEX_ARCHIVE_FLUSH_FLOOR_BYTES_PER_MS = 1000
const codexArchiveBudgetMs = (bytes: number) => CODEX_MUTATION_BASE_MS + Math.ceil(bytes / CODEX_ARCHIVE_FLUSH_FLOOR_BYTES_PER_MS)
// @@@ codexResumeThread - load an evicted thread back into the shared app-server WITHOUT running a turn. The
// app-server evicts an idle thread from its in-memory loaded set, and codex-headless readiness/liveness proves
// online only when the thread is resident (thread/loaded/list). A visible-TUI resume reloads it implicitly via
// `resume "$tid"`; headless has no TUI, so its resume must issue this `thread/resume` itself or readiness times
// out for a thread that is perfectly fine on disk. `excludeTurns` + a one-row page keeps a huge rollout from
// streaming back — we only need the load, not the history. Idempotent: reopening an already-loaded thread is a
// no-op the server answers at once.
export function codexResumeThread(sock: string, threadId: string, budgetMs = 20_000): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const conn: Socket = createConnection(sock)
    const fs: FrameState = { buf: Buffer.alloc(0), fragOp: 0, fragBuf: Buffer.alloc(0) }
    let upgraded = false, settled = false
    const done = (r: { ok: true } | { ok: false; error: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { conn.destroy() } catch { /* */ }
      resolve(r)
    }
    const timer = setTimeout(() => done({ ok: false, error: `codex app-server did not resume thread ${threadId} within ${budgetMs}ms` }), budgetMs)
    conn.on('error', (e) => done({ ok: false, error: `codex app-server connection failed: ${rpcError(e)}` }))
    conn.on('close', () => done({ ok: false, error: 'codex app-server closed before thread/resume was answered' }))
    const send = (m: JsonRpc) => conn.write(wsText(JSON.stringify(m)))
    conn.on('connect', () => conn.write(WS_UPGRADE(randomBytes(16).toString('base64'))))
    const handle = (json: string) => {
      let m: JsonRpc
      try { m = JSON.parse(json) } catch { return }
      if (m.error) return done({ ok: false, error: `codex app-server ${m.id ? `request ${m.id}` : 'notification'} failed: ${m.error.message || JSON.stringify(m.error)}` })
      if (m.id === 1 && m.result) {
        send({ method: 'initialized', params: {} })
        return send({ id: 2, method: 'thread/resume', params: { threadId, excludeTurns: true, initialTurnsPage: { limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' } } })
      }
      if (m.id === 2 && m.result) return done({ ok: true })
    }
    conn.on('data', (chunk: Buffer) => {
      fs.buf = Buffer.concat([fs.buf, chunk])
      if (!upgraded) {
        const i = fs.buf.indexOf('\r\n\r\n')
        if (i < 0) return
        const head = fs.buf.slice(0, i).toString('utf8')
        if (!/^HTTP\/1\.1 101/.test(head)) return done({ ok: false, error: 'codex app-server refused WebSocket upgrade for thread/resume' })
        upgraded = true
        fs.buf = fs.buf.slice(i + 4)
        send(wsInitialize)
      }
      if (drainWsFrames(fs, conn, handle)) done({ ok: false, error: 'codex app-server closed during thread/resume' })
    })
  })
}

// Codex treats an omitted or empty sourceKinds filter as "interactive" defaults. Cold proof must census the
// entire native thread graph, including subAgent/thread-spawn rows that have no Spex record, so the adapter
// supplies every protocol source kind explicitly for its thread/list calls.
export const CODEX_THREAD_SOURCE_KINDS = [
  'cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview', 'subAgentCompact',
  'subAgentThreadSpawn', 'subAgentOther', 'unknown',
] as const
function codexPagedIds(
  sock: string,
  method: 'thread/list' | 'thread/loaded/list',
  params: Record<string, unknown>,
  extractId: (item: unknown) => string | null,
  label: string,
  onItem?: (item: unknown) => void,
  timeoutMs = CODEX_MUTATION_CENSUS_MS,
): Promise<CodexPagedIdsResult> {
  return new Promise((resolve) => {
    const conn: Socket = createConnection(sock)
    const fs: FrameState = { buf: Buffer.alloc(0), fragOp: 0, fragBuf: Buffer.alloc(0) }
    let upgraded = false, settled = false, requestId = 2, cursor: string | null = null
    const ids = new Set<string>()
    const done = (result: CodexPagedIdsResult) => {
      if (settled) return
      settled = true; clearTimeout(timer); try { conn.destroy() } catch {}; resolve(result)
    }
    const timer = setTimeout(() => done({ ok: false, error: `Codex ${label} timed out after ${timeoutMs}ms` }), timeoutMs)
    conn.on('error', (error) => done({ ok: false, error: `Codex ${label} failed: ${rpcError(error)}` }))
    conn.on('close', () => { if (!settled) done({ ok: false, error: `Codex app-server closed during ${label}` }) })
    const send = (message: JsonRpc) => conn.write(wsText(JSON.stringify(message)))
    const requestPage = () => send({ id: requestId, method, params: { ...params, ...(cursor ? { cursor } : {}), limit: 100 } })
    conn.on('connect', () => conn.write(WS_UPGRADE(randomBytes(16).toString('base64'))))
    const handle = (json: string) => {
      let message: JsonRpc
      try { message = JSON.parse(json) } catch { return }
      if (message.error) return done({ ok: false, error: `Codex ${label} failed: ${message.error.message || JSON.stringify(message.error)}` })
      if (message.id === 1 && message.result) { send({ method: 'initialized', params: {} }); return requestPage() }
      if (message.id !== requestId || !message.result) return
      const page = message.result as { data?: unknown; nextCursor?: unknown }
      if (Array.isArray(page.data)) for (const item of page.data) {
        onItem?.(item)
        const id = extractId(item)
        if (typeof id === 'string') ids.add(id)
      }
      cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null
      if (!cursor) return done({ ok: true, ids: [...ids] })
      requestId++
      requestPage()
    }
    conn.on('data', (chunk: Buffer) => {
      fs.buf = Buffer.concat([fs.buf, chunk])
      if (!upgraded) {
        const i = fs.buf.indexOf('\r\n\r\n')
        if (i < 0) return
        const head = fs.buf.slice(0, i).toString('utf8')
        if (!/^HTTP\/1\.1 101/.test(head)) return done({ ok: false, error: `Codex app-server refused loaded-reference census: ${head.split('\r\n')[0]}` })
        upgraded = true; fs.buf = fs.buf.slice(i + 4)
        send(wsInitialize)
      }
      if (drainWsFrames(fs, conn, handle)) done({ ok: false, error: `Codex app-server closed during ${label}` })
    })
  })
}

// Lightweight resident census: unlike the full shared-runtime probe, this scans only paginated manager IDs
// and never issues thread/read includeTurns for each loaded reference.
export async function codexLoadedReferenceIds(sock: string): Promise<{ ok: true; referenceIds: string[] } | { ok: false; error: string }> {
  const result = await codexPagedIds(sock, 'thread/loaded/list', {}, (item) => {
    if (typeof item === 'string') return item
    const value = item as { id?: unknown; threadId?: unknown } | null
    return typeof value?.id === 'string' ? value.id : typeof value?.threadId === 'string' ? value.threadId : null
  }, 'loaded-reference census')
  return result.ok ? { ok: true, referenceIds: result.ids } : result
}

const CODEX_RUNNING_TURN_READ_MS = 15_000
const CODEX_COLD_PREFLIGHT_MAX_ATTEMPTS = 6
const CODEX_COLD_PREFLIGHT_RETRY_MS = 250
const CODEX_COLD_PREFLIGHT_DEADLINE_MS = 30_000

async function waitForCodexGeneration(dir: string, endpoint: CodexGenerationEndpoint): Promise<string | null> {
  const deadline = Date.now() + CODEX_COLD_PREFLIGHT_DEADLINE_MS
  for (let attempt = 0; attempt < CODEX_COLD_PREFLIGHT_MAX_ATTEMPTS; attempt++) {
    const generation = codexRuntimeGeneration(dir, endpoint)
    if (generation) return generation
    if (attempt === CODEX_COLD_PREFLIGHT_MAX_ATTEMPTS - 1 || Date.now() >= deadline) break
    const delay = Math.min(CODEX_COLD_PREFLIGHT_RETRY_MS * 2 ** attempt, deadline - Date.now())
    await new Promise((resolve) => setTimeout(resolve, delay))
  }
  return null
}

// @@@ presence vs identity - two different questions, deliberately not one helper.
// A gate asks "is a turn in flight right now"; thread/list answers that for every thread at once, at a cost
// that tracks the thread COUNT. Interrupt must additionally name the turn to interrupt, and only a turn read
// carries the id — a cost that tracks that one thread's persisted HISTORY. So this read stays for interrupt,
// where the target is by definition active and short-lived, and no gate may be routed back through it.
type CodexTurnCensus = { ok: true; turnPresence: 'idle' | 'active' | 'unknown'; turnId?: string; unmaterialized?: true } | { ok: false; error: string }

function codexRunningTurn(sock: string, threadId: string): Promise<CodexTurnCensus> {
  return new Promise((resolve) => {
    const conn: Socket = createConnection(sock)
    const fs: FrameState = { buf: Buffer.alloc(0), fragOp: 0, fragBuf: Buffer.alloc(0) }
    let upgraded = false, settled = false
    const done = (result: CodexTurnCensus) => {
      if (settled) return
      settled = true; clearTimeout(timer); try { conn.destroy() } catch {}; resolve(result)
    }
    const timer = setTimeout(() => done({ ok: false, error: `Codex target thread ${threadId} turn census timed out after ${CODEX_RUNNING_TURN_READ_MS}ms` }), CODEX_RUNNING_TURN_READ_MS)
    conn.on('error', (error) => done({ ok: false, error: `Codex target thread ${threadId} turn census failed: ${rpcError(error)}` }))
    conn.on('close', () => { if (!settled) done({ ok: false, error: `Codex app-server closed during target thread ${threadId} turn census` }) })
    const send = (message: JsonRpc) => conn.write(wsText(JSON.stringify(message)))
    conn.on('connect', () => conn.write(WS_UPGRADE(randomBytes(16).toString('base64'))))
    const handle = (json: string) => {
      let message: JsonRpc
      try { message = JSON.parse(json) } catch { return }
      if (message.error) {
        const error = message.error.message || JSON.stringify(message.error)
        if (isCodexUnmaterializedThreadError(threadId, error)) return done({ ok: true, turnPresence: 'idle', unmaterialized: true })
        return done({ ok: false, error: `Codex target thread ${threadId} turn census failed: ${error}` })
      }
      if (message.id === 1 && message.result) {
        send({ method: 'initialized', params: {} })
        // The guard needs only the current turn. `thread/read {includeTurns:true}` materializes the
        // entire persisted history, so an old but otherwise healthy thread can time out before close.
        return send({ id: 2, method: 'thread/turns/list', params: { threadId, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' } })
      }
      if (message.id !== 2 || !message.result) return
      const turns = (message.result as { data?: unknown }).data
      if (!Array.isArray(turns)) return done({ ok: true, turnPresence: 'unknown' })
      const active = turns.find((turn): turn is { id?: unknown; status?: unknown } =>
        !!turn && typeof turn === 'object' && (turn as { status?: unknown }).status === 'inProgress')
      if (!active) return done({ ok: true, turnPresence: 'idle' })
      return typeof active.id === 'string' && active.id
        ? done({ ok: true, turnPresence: 'active', turnId: active.id })
        : done({ ok: true, turnPresence: 'unknown' })
    }
    conn.on('data', (chunk: Buffer) => {
      fs.buf = Buffer.concat([fs.buf, chunk])
      if (!upgraded) {
        const i = fs.buf.indexOf('\r\n\r\n')
        if (i < 0) return
        const head = fs.buf.slice(0, i).toString('utf8')
        if (!/^HTTP\/1\.1 101/.test(head)) return done({ ok: false, error: `Codex app-server refused target thread ${threadId} turn census: ${head.split('\r\n')[0]}` })
        upgraded = true; fs.buf = fs.buf.slice(i + 4); send(wsInitialize)
      }
      if (drainWsFrames(fs, conn, handle)) done({ ok: false, error: `Codex app-server closed during target thread ${threadId} turn census` })
    })
  })
}

const CODEX_INTERRUPT_SETTLE_MS = 15_000
// Codex can report an exact pre-materialization refusal, or that a previously loaded id is no longer loaded.
// Both are positive no-turn facts for terminal close; every transport or ownership ambiguity remains fail-closed.
const isCodexUnmaterializedThreadError = (threadId: string, error: string): boolean =>
  (error.includes(threadId) && error.includes('is not materialized yet') &&
    error.includes('thread/turns/list is unavailable before first user message')) ||
  error.includes(`thread not loaded: ${threadId}`)

async function interruptCodexTurn(rec: HarnessDeliveryRecord): Promise<DispatchResult> {
  if (!rec.harnessSessionId) return { ok: false, error: 'no exact Codex thread identity is registered' }
  const threadId = rec.harnessSessionId
  const dir = rec.runtimeDir || runtimeRoot()
  const endpoint = codexEndpointForRecord(rec, dir)
  if (!endpoint) return { ok: false, error: 'no exact Codex generation binding is registered for this target' }
  const generation = await waitForCodexGeneration(dir, endpoint)
  if (!generation) return { ok: false, error: 'Codex shared app-server generation remained unproven while waiting to interrupt' }
  const fence = { dir, endpoint, generation }
  const before = await codexRunningTurn(endpoint.socketPath, threadId)
  if (!before.ok) return { ok: false, error: before.error }
  if (codexRuntimeGeneration(dir, endpoint) !== generation)
    return { ok: false, error: 'shared Codex app-server generation changed during interrupt preflight' }
  if (before.turnPresence === 'idle') return { ok: true }
  if (before.turnPresence !== 'active' || !before.turnId)
    return { ok: false, error: `Codex target thread ${threadId} turn state is unknown` }
  const interrupted = await codexThreadMutation(endpoint.socketPath, 'turn/interrupt', threadId, fence, before.turnId)
  if (!interrupted.ok) return { ok: false, error: interrupted.error }
  const deadline = Date.now() + CODEX_INTERRUPT_SETTLE_MS
  for (;;) {
    const after = await codexRunningTurn(endpoint.socketPath, threadId)
    if (!after.ok) return { ok: false, error: after.error }
    if (codexRuntimeGeneration(dir, endpoint) !== generation)
      return { ok: false, error: 'shared Codex app-server generation changed during interrupt settlement' }
    if (after.turnPresence === 'idle') return { ok: true }
    if (after.turnPresence === 'unknown') return { ok: false, error: `Codex target thread ${threadId} turn state is unknown after interrupt` }
    if (Date.now() >= deadline) return { ok: false, error: `Codex target thread ${threadId} remained active after interrupt` }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

// The app-server's loaded/list is cursor-paginated. Archive proof must scan every page; a first page that omits
// a sibling/descendant is not a cold proof. This helper is also used by the descendant guard below.
export function codexThreadList(sock: string, params: Record<string, unknown>): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  return codexThreadCollection(sock, params).then((result) => result.ok ? { ok: true, ids: result.ids } : result)
}

// Every thread/list row carries the app-server's live turn state for that thread, in the protocol's own
// three variants. `notLoaded` duplicates what thread/loaded/list reports; `idle`/`active` answer the only
// question a lifecycle gate asks. Any other shape is `unknown` and fails closed — never derived from
// something cheaper.
type CodexThreadStatus = 'notLoaded' | 'idle' | 'active' | 'unknown'
const codexRowStatus = (row: { status?: unknown }): CodexThreadStatus => {
  const type = (row.status as { type?: unknown } | null | undefined)?.type
  return type === 'notLoaded' || type === 'idle' || type === 'active' ? type : 'unknown'
}

type CodexThreadCollectionResult =
  | { ok: true; ids: string[]; parentById: Map<string, string | null>; statusById: Map<string, CodexThreadStatus> }
  | { ok: false; error: string }

function codexThreadCollection(sock: string, params: Record<string, unknown>): Promise<CodexThreadCollectionResult> {
  const sourceKinds = Array.isArray(params.sourceKinds) && params.sourceKinds.length
    ? params.sourceKinds
    : [...CODEX_THREAD_SOURCE_KINDS]
  const parentById = new Map<string, string | null>()
  const statusById = new Map<string, CodexThreadStatus>()
  const conflictingParents = new Set<string>()
  return codexPagedIds(sock, 'thread/list', { ...params, sourceKinds, useStateDbOnly: true }, (item) => {
    if (typeof item === 'string') return item
    const id = (item as { id?: unknown } | null)?.id
    return typeof id === 'string' ? id : null
  }, 'thread/list', (item) => {
    if (!item || typeof item !== 'object') return
    const row = item as { id?: unknown; parentThreadId?: unknown; status?: unknown }
    if (typeof row.id !== 'string') return
    const parent = typeof row.parentThreadId === 'string' ? row.parentThreadId : null
    if (parentById.has(row.id) && parentById.get(row.id) !== parent) conflictingParents.add(row.id)
    parentById.set(row.id, parent)
    // Parent ownership is a fact about the graph, so a disagreement across pages is a census fault.
    // Turn state is live, so a mid-drain change is not a fault — it is simply no longer knowable here.
    const status = codexRowStatus(row)
    statusById.set(row.id, statusById.has(row.id) && statusById.get(row.id) !== status ? 'unknown' : status)
  }).then((result) => {
    if (!result.ok) return result
    if (conflictingParents.size) return { ok: false as const, error: `Codex thread/list returned conflicting parent ownership for ${[...conflictingParents].join(', ')}` }
    return { ...result, parentById, statusById }
  })
}

// The gate's question is about the tip — is a turn in flight right now — and thread/list already answers it
// for every thread at once, at a cost that tracks how many threads exist. Reading turns instead costs the
// target's whole persisted history against a fixed budget, so a long-lived session becomes unmutatable.
const codexPresenceFromStatus = (status: CodexThreadStatus | undefined): SharedRuntimeMutationGuard['targetTurnPresence'] =>
  status === 'idle' || status === 'active' ? status : 'unknown'

async function codexTargetMutationGuard(threadId: string, dir = runtimeRoot(), endpoint = legacyCodexGenerationEndpoint(dir)): Promise<SharedRuntimeMutationGuard> {
  const generationBefore = codexMutationGeneration(dir, endpoint)
  if (!generationBefore) return { healthy: false, referenceIds: [], targetTurnPresence: 'unknown', descendantIds: [], error: 'Codex shared app-server generation is unproven' }
  const sock = endpoint.socketPath
  // The descendant collections are ancestor-filtered and therefore exclude the target itself, so the
  // target's own turn state comes from the whole-collection census. These run concurrently with the rest.
  const [loaded, activeDescendants, archivedDescendants, activeList, archivedList] = await Promise.all([
    codexLoadedReferenceIds(sock),
    codexThreadList(sock, { ancestorThreadId: threadId, archived: false, sourceKinds: [] }),
    codexThreadList(sock, { ancestorThreadId: threadId, archived: true, sourceKinds: [] }),
    codexThreadCollection(sock, { archived: false, sourceKinds: [] }),
    codexThreadCollection(sock, { archived: true, sourceKinds: [] }),
  ])
  const referenceIds = loaded.ok ? loaded.referenceIds : []
  const descendantIds = activeDescendants.ok && archivedDescendants.ok
    ? [...new Set([...activeDescendants.ids, ...archivedDescendants.ids])]
    : []
  if (!loaded.ok) return { healthy: false, referenceIds, targetTurnPresence: 'unknown', descendantIds, error: loaded.error }
  if (!activeDescendants.ok) return { healthy: false, referenceIds, targetTurnPresence: 'unknown', descendantIds, error: activeDescendants.error }
  if (!archivedDescendants.ok) return { healthy: false, referenceIds, targetTurnPresence: 'unknown', descendantIds, error: archivedDescendants.error }
  if (!activeList.ok) return { healthy: false, referenceIds, targetTurnPresence: 'unknown', descendantIds, error: activeList.error }
  if (!archivedList.ok) return { healthy: false, referenceIds, targetTurnPresence: 'unknown', descendantIds, error: archivedList.error }
  const targetTurnPresence: SharedRuntimeMutationGuard['targetTurnPresence'] = referenceIds.includes(threadId)
    ? codexPresenceFromStatus(activeList.statusById.get(threadId) ?? archivedList.statusById.get(threadId))
    : 'none'
  if (codexRuntimeGeneration(dir, endpoint) !== generationBefore)
    return { healthy: false, referenceIds, targetTurnPresence, descendantIds, error: 'shared Codex app-server generation changed during target guard' }
  return { healthy: true, referenceIds, targetTurnPresence, descendantIds }
}

const CODEX_COLD_PLAN = Symbol('codex-cold-plan')
type CodexColdPlan = Readonly<{
  [CODEX_COLD_PLAN]: true
  kind: 'codex-cold-subtree-v1'
  unmaterialized?: true
  threadId: string
  generation: string
  endpoint: CodexGenerationEndpoint
  guard: SharedRuntimeMutationGuard
  descendantIds: readonly string[]
  parentEdges: readonly (readonly [string, string])[]
  subtreeIds: readonly string[]
  activeIds: readonly string[]
  archivedIds: readonly string[]
}>
type CodexColdPreflight = { ok: true; alreadyCold?: boolean; receipt: CodexColdPlan } | { ok: false; reason: string }

const sameIdSet = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((id) => right.includes(id))

const sameParentEdges = (left: readonly (readonly [string, string])[], right: readonly (readonly [string, string])[]) =>
  left.length === right.length && left.every(([id, parent]) => right.some(([otherId, otherParent]) => id === otherId && parent === otherParent))

const isCodexColdPlan = (value: unknown): value is CodexColdPlan => {
  if (!value || typeof value !== 'object') return false
  const plan = value as Partial<CodexColdPlan>
  return plan[CODEX_COLD_PLAN] === true && plan.kind === 'codex-cold-subtree-v1' && typeof plan.threadId === 'string' &&
    typeof plan.generation === 'string' && isEndpointLike(plan.endpoint) && Array.isArray(plan.descendantIds) &&
    Array.isArray(plan.parentEdges) && Array.isArray(plan.subtreeIds) &&
    Array.isArray(plan.activeIds) && Array.isArray(plan.archivedIds) && !!plan.guard
}

function isEndpointLike(value: unknown): value is CodexGenerationEndpoint {
  return !!value && typeof value === 'object' && typeof (value as CodexGenerationEndpoint).id === 'string' &&
    typeof (value as CodexGenerationEndpoint).pidFile === 'string' && typeof (value as CodexGenerationEndpoint).receiptFile === 'string' &&
    typeof (value as CodexGenerationEndpoint).socketPath === 'string'
}

function makeCodexColdPlan(input: {
  threadId: string
  generation: string
  endpoint: CodexGenerationEndpoint
  guard: SharedRuntimeMutationGuard
  descendantIds: readonly string[]
  parentEdges: readonly (readonly [string, string])[]
  subtreeIds: readonly string[]
  activeIds: readonly string[]
  archivedIds: readonly string[]
  unmaterialized?: true
}): CodexColdPlan {
  return Object.freeze({
    [CODEX_COLD_PLAN]: true as const,
    kind: 'codex-cold-subtree-v1' as const,
    ...(input.unmaterialized ? { unmaterialized: true as const } : {}),
    threadId: input.threadId,
    generation: input.generation,
    endpoint: input.endpoint,
    guard: input.guard,
    descendantIds: Object.freeze([...input.descendantIds]),
    parentEdges: Object.freeze([...input.parentEdges]),
    subtreeIds: Object.freeze([...input.subtreeIds]),
    activeIds: Object.freeze([...input.activeIds]),
    archivedIds: Object.freeze([...input.archivedIds]),
  })
}

async function codexColdPreflightOnce(threadId: string, dir = runtimeRoot(), expectedGeneration?: string, endpoint = legacyCodexGenerationEndpoint(dir)): Promise<CodexColdPreflight> {
  const generation = expectedGeneration ?? codexMutationGeneration(dir, endpoint)
  if (!generation)
    return { ok: false, reason: 'Codex shared app-server generation is temporarily unproven before subtree census' }
  if (codexRuntimeGeneration(dir, endpoint) !== generation)
    return { ok: false, reason: 'Codex shared app-server generation changed before subtree census' }
  const sock = endpoint.socketPath
  const [loaded, activeDescendants, archivedDescendants, archivedList, activeList] = await Promise.all([
    codexLoadedReferenceIds(sock),
    codexThreadCollection(sock, { ancestorThreadId: threadId, archived: false, sourceKinds: [] }),
    codexThreadCollection(sock, { ancestorThreadId: threadId, archived: true, sourceKinds: [] }),
    codexThreadCollection(sock, { archived: true, sourceKinds: [] }),
    codexThreadCollection(sock, { archived: false, sourceKinds: [] }),
  ])
  if (codexRuntimeGeneration(dir, endpoint) !== generation)
    return { ok: false, reason: 'shared Codex app-server generation changed during subtree census' }
  if (!loaded.ok) return { ok: false, reason: loaded.error }
  if (!activeDescendants.ok) return { ok: false, reason: activeDescendants.error }
  if (!archivedDescendants.ok) return { ok: false, reason: archivedDescendants.error }
  if (!archivedList.ok) return { ok: false, reason: archivedList.error }
  if (!activeList.ok) return { ok: false, reason: activeList.error }

  const activeDescendantSet = new Set(activeDescendants.ids)
  const archivedDescendantSet = new Set(archivedDescendants.ids)
  const duplicateDescendants = activeDescendants.ids.filter((id) => archivedDescendantSet.has(id))
  if (duplicateDescendants.length)
    return { ok: false, reason: `Codex subtree members occur in both active and archived descendant collections (${duplicateDescendants.join(', ')})` }
  const descendantIds = [...activeDescendants.ids, ...archivedDescendants.ids]
  if (descendantIds.includes(threadId)) return { ok: false, reason: `Codex target ${threadId} is duplicated in its own descendant closure` }

  const activeSet = new Set(activeList.ids)
  const archivedSet = new Set(archivedList.ids)
  if (!activeSet.has(threadId) && !archivedSet.has(threadId) && descendantIds.length === 0) {
    // A Codex thread id can be registered before the server materializes its first user message. The exact
    // protocol refusal is the only proof that this absent native target is that startup window, rather than
    // an unowned/reassigned record that must stay fail-closed.
    const turn = await codexRunningTurn(sock, threadId)
    if (!turn.ok) return { ok: false, reason: turn.error }
    if (codexRuntimeGeneration(dir, endpoint) !== generation)
      return { ok: false, reason: 'shared Codex app-server generation changed while confirming an unmaterialized thread' }
    if (turn.unmaterialized) {
      const loadedTarget = loaded.referenceIds.includes(threadId)
      const guard: SharedRuntimeMutationGuard = {
        healthy: true,
        referenceIds: [...loaded.referenceIds],
        targetTurnPresence: 'none',
        descendantIds: [],
      }
      return {
        ok: true,
        ...(loadedTarget ? {} : { alreadyCold: true }),
        receipt: makeCodexColdPlan({
          threadId,
          generation,
          endpoint,
          guard,
          descendantIds: [],
          parentEdges: [],
          subtreeIds: [threadId],
          activeIds: loadedTarget ? [threadId] : [],
          archivedIds: [],
          unmaterialized: true,
        }),
      }
    }
  }

  const parentById = new Map([...activeDescendants.parentById, ...archivedDescendants.parentById])
  const depthById = new Map<string, number>()
  for (const id of descendantIds) {
    const seen = new Set([id])
    let cursor = id
    let depth = 0
    while (cursor !== threadId) {
      const next = parentById.get(cursor)
      if (!next) return { ok: false, reason: `Codex descendant ${id} has no complete parent chain to target ${threadId} (unowned or reassigned)` }
      if (seen.has(next)) return { ok: false, reason: `Codex descendant ${id} has a cyclic parent chain` }
      seen.add(next)
      cursor = next
      depth++
    }
    depthById.set(id, depth)
  }

  const subtreeIds = [...descendantIds, threadId]
  for (const id of subtreeIds) {
    const inActive = activeSet.has(id)
    const inArchived = archivedSet.has(id)
    if (!inActive && !inArchived)
      return { ok: false, reason: `Codex subtree member ${id} is absent from both native collections (unowned or reassigned)` }
    if (inActive && inArchived)
      return { ok: false, reason: `Codex subtree member ${id} occurs in both active and archived native collections` }
    if (id !== threadId) {
      const expectedActive = activeDescendantSet.has(id)
      if (inActive !== expectedActive)
        return { ok: false, reason: `Codex subtree member ${id} changed collection assignment during ownership census` }
    }
  }

  // Every subtree member was just proven to occur in exactly one whole-collection census, so that census
  // already carries each one's live turn state. No second round of native reads, and therefore no second
  // generation fence — nothing was read between the fence above and here.
  const statusById = new Map([...activeList.statusById, ...archivedList.statusById])
  const loadedSet = new Set(loaded.referenceIds)
  const loadedSubtreeIds = subtreeIds.filter((id) => loadedSet.has(id))
  for (const id of loadedSubtreeIds) {
    const presence = codexPresenceFromStatus(statusById.get(id))
    if (presence === 'active') return { ok: false, reason: `Codex subtree member ${id} has an active turn` }
    if (presence === 'unknown') {
      const rollout = codexRolloutTurnSettlement(id)
      if (!rollout.settled) {
        return {
          ok: false,
          reason: `Codex subtree member ${id} turn state is unknown: live Codex client did not report a determinate turn state; ${rollout.reason}`,
        }
      }
    }
    if (archivedSet.has(id)) return { ok: false, reason: `Codex archived subtree member ${id} remains loaded` }
  }

  // Proven, not assumed: a loaded target is one of the members the loop above just cleared.
  const targetTurnPresence: SharedRuntimeMutationGuard['targetTurnPresence'] = loadedSet.has(threadId) ? 'idle' : 'none'
  const guard: SharedRuntimeMutationGuard = {
    healthy: true,
    referenceIds: [...loaded.referenceIds],
    targetTurnPresence,
    descendantIds: [...descendantIds],
  }
  const activeIds = [...activeDescendants.ids]
    .sort((left, right) => (depthById.get(right) ?? 0) - (depthById.get(left) ?? 0))
    .concat(activeSet.has(threadId) ? [threadId] : [])
  const archivedIds = [...archivedDescendants.ids, ...(archivedSet.has(threadId) ? [threadId] : [])]
  const parentEdges = descendantIds.map((id) => [id, parentById.get(id)!] as const)
  const receipt = makeCodexColdPlan({ threadId, generation, endpoint, guard, descendantIds, parentEdges, subtreeIds, activeIds, archivedIds })
  return { ok: true, ...(activeIds.length ? {} : { alreadyCold: true }), receipt }
}

// A busy app-server can refuse one WebSocket census while accepting the next. The refusal is transport-local,
// so retry the complete proof (including generation fencing) within the terminal operation's finite budget;
// semantic ownership refusals still return immediately and never turn into repeated native reads.
const isTransientCodexCensusFailure = (reason: string): boolean =>
  /(?:temporarily unproven|timed out|connection|closed during|refused .*census|census failed|app-server busy)/i.test(reason)

async function codexColdPreflight(threadId: string, dir = runtimeRoot(), expectedGeneration?: string, endpoint = legacyCodexGenerationEndpoint(dir)): Promise<CodexColdPreflight> {
  const deadline = Date.now() + CODEX_COLD_PREFLIGHT_DEADLINE_MS
  for (let attempt = 0; attempt < CODEX_COLD_PREFLIGHT_MAX_ATTEMPTS; attempt++) {
    const result = await codexColdPreflightOnce(threadId, dir, expectedGeneration, endpoint)
    if (result.ok || !isTransientCodexCensusFailure(result.reason) || attempt === CODEX_COLD_PREFLIGHT_MAX_ATTEMPTS - 1) return result
    const remaining = deadline - Date.now()
    if (remaining <= 0) return result
    const delay = Math.min(CODEX_COLD_PREFLIGHT_RETRY_MS * 2 ** attempt, remaining)
    await new Promise((resolve) => setTimeout(resolve, delay))
  }
  throw new Error('unreachable Codex cold preflight retry state')
}

type CodexOrphanEndpointScan =
  | { endpoint: CodexGenerationEndpoint; generation: string; containsTarget: boolean }
  | { endpoint: CodexGenerationEndpoint; reason: string }

type CodexOrphanEndpointResolution =
  | { ok: true; endpoint: CodexGenerationEndpoint; generation: string }
  | { ok: false; reason: string }

// A corrupt record has no binding we can trust. Locate its one materialized native thread before cold proof;
// choosing current or legacy would redirect a destructive operation across a generation boundary.
async function codexEndpointForOrphanThread(threadId: string, dir = runtimeRoot()): Promise<CodexOrphanEndpointResolution> {
  const tracked = codexGenerationEndpoints(dir)
  const endpoints = tracked.length ? tracked : [legacyCodexGenerationEndpoint(dir)]
  const scans: CodexOrphanEndpointScan[] = await Promise.all(endpoints.map(async (endpoint) => {
    const generation = codexMutationGeneration(dir, endpoint)
    if (!generation) return { endpoint, reason: 'Codex shared app-server generation is unproven' }
    const [active, archived] = await Promise.all([
      codexThreadList(endpoint.socketPath, { archived: false, sourceKinds: [] }),
      codexThreadList(endpoint.socketPath, { archived: true, sourceKinds: [] }),
    ])
    if (codexRuntimeGeneration(dir, endpoint) !== generation)
      return { endpoint, reason: 'Codex shared app-server generation changed during orphan location' }
    if (!active.ok) return { endpoint, reason: active.error }
    if (!archived.ok) return { endpoint, reason: archived.error }
    return { endpoint, generation, containsTarget: active.ids.includes(threadId) || archived.ids.includes(threadId) }
  }))
  const failed = scans.find((scan): scan is Extract<CodexOrphanEndpointScan, { reason: string }> => 'reason' in scan)
  if (failed) return { ok: false, reason: `${failed.reason} while locating orphan Codex thread ${threadId} on generation ${failed.endpoint.id}` }
  const matches = scans.filter((scan): scan is Extract<CodexOrphanEndpointScan, { containsTarget: boolean }> =>
    'containsTarget' in scan && scan.containsTarget)
  if (matches.length !== 1) {
    const detail = matches.length ? matches.map((scan) => scan.endpoint.id).join(', ') : 'none'
    return { ok: false, reason: `Codex orphan thread ${threadId} has ${matches.length === 0 ? 'no materialized' : 'ambiguous'} generation location (${detail})` }
  }
  return { ok: true, endpoint: matches[0].endpoint, generation: matches[0].generation }
}

async function codexQuarantineOrphanThread(threadId: string, opts: { excludingSessionId: string }): Promise<HarnessOrphanThreadQuarantine> {
  const dir = runtimeRoot()
  const owners = governedSharedRuntimeOwners(dir, 'codex-app-server', threadId, opts.excludingSessionId)
  if (owners === null) return { ok: false, reason: 'governed Codex thread-owner census is unreadable' }
  if (owners.length) return { ok: false, reason: `Codex native thread ${threadId} has governed owner(s) ${owners.join(', ')}` }
  const location = await codexEndpointForOrphanThread(threadId, dir)
  if (!location.ok) return location
  const { endpoint, generation } = location
  const before = await codexColdPreflight(threadId, dir, generation, endpoint)
  if (!before.ok) return before
  const plan = before.receipt
  if (plan.descendantIds.length || plan.guard.descendantIds.length)
    return { ok: false, reason: `Codex native thread ${threadId} has descendants (${[...new Set([...plan.descendantIds, ...plan.guard.descendantIds])].join(', ')})` }
  if (plan.guard.targetTurnPresence === 'active' || plan.guard.targetTurnPresence === 'unknown')
    return { ok: false, reason: `Codex native thread ${threadId} is ${plan.guard.targetTurnPresence === 'active' ? 'active' : 'unknown'}` }
  if (plan.subtreeIds.length !== 1 || plan.subtreeIds[0] !== threadId)
    return { ok: false, reason: `Codex native thread ${threadId} has an ambiguous ownership closure` }
  const unchangedOwners = () => governedSharedRuntimeOwners(dir, 'codex-app-server', threadId, opts.excludingSessionId)
  const rollback = () => codexRestoreColdPlan(plan, dir)
  if (plan.activeIds.length === 0) {
    if (plan.archivedIds.length !== 1 || plan.archivedIds[0] !== threadId || plan.guard.referenceIds.includes(threadId))
      return { ok: false, reason: `Codex native thread ${threadId} is not uniquely archived and unloaded` }
    const afterOwners = unchangedOwners()
    if (afterOwners === null || afterOwners.length) return { ok: false, reason: 'governed Codex thread-owner census changed during quarantine verification' }
    return { ok: true, audit: { adapter: 'codex', threadId, action: 'already-unloaded' }, compensate: async () => ({ ok: true }) }
  }
  if (plan.activeIds.length !== 1 || plan.activeIds[0] !== threadId || plan.archivedIds.length)
    return { ok: false, reason: `Codex native thread ${threadId} is not one exact active orphan` }
  const siblingIds = plan.guard.referenceIds.filter((id) => id !== threadId)
  // Quarantine archives one exact orphan, so it pays the same flush a subtree member does when that orphan is
  // loaded; the budget is derived the same way rather than being a second, differently-wrong constant.
  let orphanBudgetMs = CODEX_MUTATION_BASE_MS
  if (plan.guard.referenceIds.includes(threadId)) {
    const rollout = codexRolloutBytes(threadId)
    if ('unreadable' in rollout) return { ok: false, reason: `Codex native thread ${threadId} is loaded and its rollout exists but cannot be measured, so the archive flush budget is unknown` }
    orphanBudgetMs = codexArchiveBudgetMs(rollout.bytes)
  }
  const archived = await codexThreadMutation(endpoint.socketPath, 'thread/archive', threadId, { dir, endpoint, generation }, undefined, orphanBudgetMs)
  if (!archived.ok) return { ok: false, reason: `${archived.error} while archiving orphan Codex thread ${threadId}${archived.commit === 'unknown' ? '; commit state is unknown' : ''}` }
  const after = await codexColdPreflight(threadId, dir, generation, endpoint)
  const failed = (reason: string): HarnessOrphanThreadQuarantine => ({ ok: false, reason })
  if (!after.ok) {
    const restored = await rollback()
    return failed(restored.ok ? after.reason : `${after.reason}; ${restored.reason}`)
  }
  const afterOwners = unchangedOwners()
  const afterPlan = after.receipt
  const valid = afterPlan.descendantIds.length === 0 && afterPlan.subtreeIds.length === 1 && afterPlan.subtreeIds[0] === threadId &&
    afterPlan.activeIds.length === 0 && afterPlan.archivedIds.length === 1 && afterPlan.archivedIds[0] === threadId &&
    !afterPlan.guard.referenceIds.includes(threadId) && siblingIds.every((id) => afterPlan.guard.referenceIds.includes(id)) &&
    afterOwners !== null && afterOwners.length === 0
  if (!valid) {
    const restored = await rollback()
    return failed(restored.ok ? `Codex orphan thread ${threadId} changed during archive verification` : `Codex orphan thread ${threadId} changed during archive verification; ${restored.reason}`)
  }
  return { ok: true, audit: { adapter: 'codex', threadId, action: 'archived' }, compensate: rollback }
}

async function codexMutationGuard(
  threadId: string,
  dir = runtimeRoot(),
  opts: { coldReceipt?: unknown } = {},
  endpoint = legacyCodexGenerationEndpoint(dir),
): Promise<SharedRuntimeMutationGuard> {
  if (opts.coldReceipt === undefined) return codexTargetMutationGuard(threadId, dir, endpoint)
  if (!isCodexColdPlan(opts.coldReceipt) || opts.coldReceipt.threadId !== threadId)
    return { healthy: false, referenceIds: [], targetTurnPresence: 'unknown', descendantIds: [], error: 'adapter cold teardown receipt is invalid' }
  if (opts.coldReceipt.endpoint.id !== endpoint.id) return { healthy: false, referenceIds: [], targetTurnPresence: 'unknown', descendantIds: [], error: 'adapter cold teardown receipt names a different generation' }
  const current = await codexColdPreflight(threadId, dir, opts.coldReceipt.generation, endpoint)
  if (!current.ok) {
    const guard = await codexTargetMutationGuard(threadId, dir, endpoint)
    return { ...guard, healthy: false, coldTeardownAuthorized: false, error: current.reason }
  }
  const authorized = sameIdSet(opts.coldReceipt.descendantIds, current.receipt.descendantIds) &&
    sameParentEdges(opts.coldReceipt.parentEdges, current.receipt.parentEdges) &&
    sameIdSet(opts.coldReceipt.activeIds, current.receipt.activeIds) &&
    sameIdSet(opts.coldReceipt.archivedIds, current.receipt.archivedIds)
  return {
    ...current.receipt.guard,
    healthy: authorized,
    coldTeardownAuthorized: authorized,
    ...(authorized ? {} : { error: 'adapter cold teardown receipt no longer matches the target subtree' }),
  }
}

async function codexRestoreColdPlan(plan: CodexColdPlan, dir = runtimeRoot()): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (codexRuntimeGeneration(dir, plan.endpoint) !== plan.generation)
    return { ok: false, reason: 'shared Codex app-server generation changed, so no compensation was attempted' }
  const sock = plan.endpoint.socketPath
  const [activeBefore, archivedBefore] = await Promise.all([
    codexThreadList(sock, { archived: false, sourceKinds: [] }),
    codexThreadList(sock, { archived: true, sourceKinds: [] }),
  ])
  if (!activeBefore.ok || !archivedBefore.ok)
    return { ok: false, reason: 'archive state is unknown and could not be reconciled' }
  if (codexRuntimeGeneration(dir, plan.endpoint) !== plan.generation)
    return { ok: false, reason: 'shared Codex app-server generation changed, so no compensation was attempted' }
  const activeSet = new Set(activeBefore.ids)
  const archivedSet = new Set(archivedBefore.ids)
  if (plan.archivedIds.some((id) => !archivedSet.has(id) || activeSet.has(id)))
    return { ok: false, reason: 'an originally-archived Codex subtree member changed collection; compensation was not authorized' }
  if (plan.activeIds.some((id) => activeSet.has(id) === archivedSet.has(id)))
    return { ok: false, reason: 'an originally-active Codex subtree member has ambiguous collection state' }
  const fence = { dir, endpoint: plan.endpoint, generation: plan.generation }
  const restoreIds = [...plan.activeIds].reverse().filter((id) => archivedSet.has(id))
  for (const id of restoreIds) {
    const restored = await codexThreadMutation(sock, 'thread/unarchive', id, fence)
    if (!restored.ok) return { ok: false, reason: `compensation failed for ${id}: ${restored.error}` }
  }
  const [activeAfter, archivedAfter] = await Promise.all([
    codexThreadList(sock, { archived: false, sourceKinds: [] }),
    codexThreadList(sock, { archived: true, sourceKinds: [] }),
  ])
  const restored = activeAfter.ok && archivedAfter.ok && codexRuntimeGeneration(dir, plan.endpoint) === plan.generation &&
    plan.activeIds.every((id) => activeAfter.ids.includes(id) && !archivedAfter.ids.includes(id)) &&
    plan.archivedIds.every((id) => archivedAfter.ids.includes(id) && !activeAfter.ids.includes(id))
  return restored ? { ok: true } : { ok: false, reason: 'compensation failed or archive state is unknown' }
}

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

// Resource ownership asks the adapter for what the shared server actually owns now. Records are joined later;
// they are never treated as references by themselves. A loaded thread is a control-plane reference and its
// fresh inProgress turn (the same predicate used by delivery) distinguishes active from addressable-idle.
export function codexSharedRuntimeProbe(dir = runtimeRoot(), endpoint = legacyCodexGenerationEndpoint(dir), referenceIds?: readonly string[]): Promise<SharedRuntimeProbe> {
  const sock = endpoint.socketPath
  return (async () => {
    // File presence is not process identity. A dead PID plus a stale socket file is the normal crash residue;
    // only a live PID and a live listener establish a resident control plane. This keeps a deliberately absent
    // root a healthy empty census while leaving live-but-ambiguous roots loud and visible.
    let pid = 0
    try { pid = Number(readFileSync(endpoint.pidFile, 'utf8').trim()) } catch { /* absent/stale */ }
    const pidLive = pid > 0 && !!processStartToken(pid)
    const listener = await listenerAt(sock, 800)
    if (!pidLive && listener === 'dead') return { healthy: true, references: [] }
    if (!pidLive || listener !== 'live') return { healthy: false, references: [], error: 'Codex shared root state is unknown (PID/listener identity is not proven)' }
    const generation = codexRuntimeGeneration(dir, endpoint)
    if (!generation) return { healthy: false, references: [], error: 'Codex shared root detached receipt/socket generation is not proven' }
    return new Promise<SharedRuntimeProbe>((resolve) => {
    const conn: Socket = createConnection(sock)
    const fs: FrameState = { buf: Buffer.alloc(0), fragOp: 0, fragBuf: Buffer.alloc(0) }
    const references = new Map<string, SharedRuntimeProbe['references'][number]>()
    const requests = new Map<number, string>()
    const loadedRequests = new Set<number>()
    const loadedIds = new Set<string>()
    let loadedRequestId = 2
    let loadedCursor: string | null = null
    let upgraded = false
    let settled = false
    let timer: NodeJS.Timeout
    const done = (result: SharedRuntimeProbe) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { conn.destroy() } catch { /* */ }
      resolve(result.healthy && codexRuntimeGeneration(dir, endpoint) !== generation
        ? { healthy: false, references: result.references, error: 'Codex shared root detached receipt/socket generation changed during ownership probe' }
        : result)
    }
    const fail = (error: string) => done({ healthy: false, references: [...references.values()], error })
    timer = setTimeout(() => fail('codex app-server ownership probe timed out after 5000ms'), 5000)
    conn.on('error', (e) => fail(`codex app-server ownership probe failed: ${rpcError(e)}`))
    conn.on('close', () => fail('codex app-server closed during ownership probe'))
    const send = (m: JsonRpc) => conn.write(wsText(JSON.stringify(m)))
    conn.on('connect', () => conn.write(WS_UPGRADE(randomBytes(16).toString('base64'))))
    const handle = (json: string) => {
      let m: JsonRpc
      try { m = JSON.parse(json) } catch { return }
      if (m.error) {
        if (typeof m.id === 'number' && loadedRequests.has(m.id)) return fail(`codex app-server loaded/list failed: ${m.error.message || JSON.stringify(m.error)}`)
        const request = typeof m.id === 'number' ? requests.get(m.id) : undefined
        if (request) {
          requests.delete(m.id!)
          if (!requests.size) done({ healthy: true, references: [...references.values()] })
          return
        }
        return fail(`codex app-server ownership request ${m.id ?? 'notification'} failed: ${m.error.message || JSON.stringify(m.error)}`)
      }
      if (m.id === 1 && m.result) {
        send({ method: 'initialized', params: {} })
        loadedRequests.add(loadedRequestId)
        return send({ id: loadedRequestId, method: 'thread/loaded/list', params: { limit: 100 } })
      }
      if (typeof m.id === 'number' && loadedRequests.has(m.id) && m.result) {
        loadedRequests.delete(m.id)
        const data = (m.result as { data?: unknown }).data
        const ids = [...new Set(Array.isArray(data) ? data.flatMap((item) => {
          if (typeof item === 'string') return [item]
          const id = (item as { id?: unknown; threadId?: unknown })?.id ?? (item as { threadId?: unknown })?.threadId
          return typeof id === 'string' ? [id] : []
        }) : [])]
        for (const threadId of ids) loadedIds.add(threadId)
        const next = (m.result as { nextCursor?: unknown }).nextCursor
        loadedCursor = typeof next === 'string' && next ? next : null
        if (loadedCursor) {
          loadedRequestId++
          loadedRequests.add(loadedRequestId)
          return send({ id: loadedRequestId, method: 'thread/loaded/list', params: { cursor: loadedCursor, limit: 100 } })
        }
        // Continue with the complete paginated set, not just the first manager page.
        if (!loadedIds.size) return done({ healthy: true, references: [] })
        const wanted = referenceIds === undefined ? [...loadedIds] : [...loadedIds].filter((threadId) => referenceIds.includes(threadId))
        loadedIds.forEach((threadId) => references.set(threadId, { referenceId: threadId, turnPresence: 'unknown' }))
        // A draining generation deliberately has no native turn reads. Complete the census after recording
        // loaded ownership; leaving the request map empty would otherwise wait for the global timeout forever.
        if (!wanted.length) return done({ healthy: true, references: [...references.values()] })
        wanted.forEach((threadId) => {
          const id = 100 + requests.size
          requests.set(id, threadId)
          // Ownership sampling only needs the native status, never the persisted turn history. The old
          // includeTurns:true request made a periodic resource report replay every loaded conversation and
          // was the direct source of 5s probe timeouts on the draining generation.
          send({ id, method: 'thread/read', params: { threadId, includeTurns: false } })
        })
        return
      }
      if (typeof m.id === 'number' && requests.has(m.id) && m.result) {
        const threadId = requests.get(m.id)!
        requests.delete(m.id)
        const thread = (m.result as { thread?: { status?: { type?: unknown } | string; turns?: Array<{ id?: string; status?: string }> } }).thread
        const turnId = activeTurnIdFromThread(m.result)
        const nativeStatus = typeof thread?.status === 'string' ? thread.status : thread?.status?.type
        references.set(threadId, {
          referenceId: threadId,
          turnPresence: turnId || nativeStatus === 'active' ? 'active' : nativeStatus === 'idle' ? 'idle' : 'unknown',
          ...(turnId ? { turnId } : {}),
        })
        if (!requests.size) done({ healthy: true, references: [...references.values()] })
      }
    }
    conn.on('data', (chunk: Buffer) => {
      fs.buf = Buffer.concat([fs.buf, chunk])
      if (!upgraded) {
        const i = fs.buf.indexOf('\r\n\r\n')
        if (i < 0) return
        const head = fs.buf.slice(0, i).toString('utf8')
        if (!/^HTTP\/1\.1 101/.test(head)) return fail(`codex app-server refused ownership probe: ${head.split('\r\n')[0]}`)
        upgraded = true
        fs.buf = fs.buf.slice(i + 4)
        send(wsInitialize)
      }
      if (drainWsFrames(fs, conn, handle)) fail('codex app-server closed during ownership probe')
    })
    })
  })()
}

// @@@ codexStartThread - the BACKEND owns the thread. On the shared PER-PROJECT app-server we `thread/start
// { cwd }` (codex resolves config/hooks/AGENTS.md from that worktree cwd — exactly as claude loads CLAUDE.md
// per-worktree — so one project-scoped server behaves analogously to a per-worktree launch), and the result
// carries the new thread id (`result.thread.id`). The launcher stores that id on the governed record and
// fires the first turn; there is no capture hook and no rollout/cwd scan. Same WS framing as codexThreadId.
// Never throws.
// @@@ codexStartThreadParams - what a BACKEND-owned thread is created with. `config` is the per-request
// override map carrying `bypass_hook_trust` so our hooks run and `shell_environment_policy.set` so every
// command this thread spawns carries the governed record id. Typed approval/sandbox fields carry the pinned
// launcher's autonomy policy; putting those flags only on the later remote TUI cannot change this thread.
export function codexStartThreadParams(cwd?: string, bypassHookTrust = false, shellEnv?: Record<string, string>, policy: CodexThreadPolicy = {}): Record<string, unknown> {
  const config = {
    ...(bypassHookTrust ? { bypass_hook_trust: true } : {}),
    ...(shellEnv && Object.keys(shellEnv).length ? { shell_environment_policy: { set: shellEnv } } : {}),
  }
  return { ...(cwd ? { cwd } : {}), ...policy, ...(Object.keys(config).length ? { config } : {}) }
}
export function codexStartThread(sock: string, cwd?: string, bypassHookTrust = false, shellEnv?: Record<string, string>, policy: CodexThreadPolicy = {}): Promise<{ ok: true; threadId: string } | { ok: false; error: string }> {
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
      if (m.id === 1 && m.result) {
        send({ method: 'initialized', params: {} })
        // thread/start's `config` is the per-request override map the app-server reads (config_manager reads
        // `request_overrides["bypass_hook_trust"]`) — the ONLY channel that reaches the thread config; the
        // `--dangerously-bypass-hook-trust` flag on the `codex app-server` invocation is INERT (the app-server
        // never reads it for a thread), so a BACKEND-owned thread must carry the bypass here, exactly as codex's
        // own `--remote resume` TUI client injects it. Without it the worktree's UNtrusted `.codex` config layer
        // stays disabled → no local hooks discovered → no Stop gate. Only on the bypass path (older codex without
        // the flag uses writeCodexTrust's hash and never sees this key).
        // The same override map carries the thread's IDENTITY. A codex tool shell is spawned by the SHARED
        // app-server, so it can inherit no session id — and must not, that leak was github#76. Codex's own
        // `shell_environment_policy.set` injects vars into every command THIS thread spawns, so the backend
        // stamps the governed record id there at thread creation, the same moment and the same knowledge with
        // which a claude launch bakes it into its agent's env. Identity then arrives per-thread, needing no
        // alias, no store lookup, and no cwd anywhere downstream.
        return send({ id: 2, method: 'thread/start', params: codexStartThreadParams(cwd, bypassHookTrust, shellEnv, policy) })
      }
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

const codexTurnConfirmMs = () => {
  const configured = Number(process.env.SPEXCODE_CODEX_TURN_CONFIRM_MS)
  return Number.isFinite(configured) && configured >= 100 ? configured : 15_000
}

function sendCodexAppServerTurn(sock: string, threadId: string, text: string, cwd?: string, clientUserMessageId?: string): Promise<DispatchResult> {
  return new Promise((resolve) => {
    const conn: Socket = createConnection(sock)
    const hs = codexHandshakeMessages(threadId)   // [initialize(1), initialized, thread/loaded/list(2)]
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
    const unresolved = (error: string) => done({ ok: false, error })
    const timer = setTimeout(() => unresolved(`codex app-server did not confirm the turn within ${codexTurnConfirmMs()}ms`), codexTurnConfirmMs())
    conn.on('error', (e) => unresolved(`codex app-server connection failed: ${rpcError(e)}`))
    conn.on('close', () => unresolved('codex app-server closed the connection before the turn was confirmed'))
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
          return send(codexInjectMessage(threadId, text, cwd, null, 5, clientUserMessageId))
        if (m.id === 3)                                                     // thread not readable yet (a freshly-started thread is "not materialized
          return send(codexInjectMessage(threadId, text, cwd, null, 5, clientUserMessageId)) // before its first user message") → just turn/start
        return done({ ok: false, error: `codex app-server ${m.id ? `request ${m.id}` : 'notification'} failed: ${m.error.message || JSON.stringify(m.error)}` })
      }
      // JSON-RPC initialization is ordered. Under a quiet server the premature notification happened to win;
      // under shared app-server load it was ignored and every later turn waited until the old 5s wall expired.
      if (m.id === 1 && m.result) { send(hs[1]); return send(hs[2]) }      // initialize ack → initialized → ask which threads are loaded
      if (m.id === 2 && m.result) {                                         // loaded-thread list → confirm OUR thread is live, then inject
        const loaded = (m.result as { data?: unknown })?.data
        if (Array.isArray(loaded) && !loaded.includes(threadId))
          return done({ ok: false, error: `Codex thread ${threadId} is not loaded in the app-server (loaded: ${loaded.join(', ') || 'none'}) — immediate poke not accepted` })
        const turnId = codexObservedActiveTurnId(threadId)
        steering = !!turnId
        return send(codexInjectMessage(threadId, text, cwd, turnId, 4, clientUserMessageId)) // id 4: turn/steer the live turn, or turn/start
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
        if (op === 0x8) return unresolved('codex app-server sent a WebSocket close before turn/start was confirmed')
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
        send(hs[0])                 // wait for initialize before its required initialized notification
      }
      drainFrames()
    })
  })
}

// fire a turn on an owned thread over the per-project socket — the same steer-vs-start delivery the live UI
// uses. The launcher calls this to materialize a freshly-started thread's rollout (the first turn = the launch
// prompt), and delivery reuses it for follow-ups. Exported so the CLI's `codex-launch` can fire the first turn.
export function codexTurn(sock: string, threadId: string, text: string, cwd?: string, clientUserMessageId?: string): Promise<DispatchResult> {
  return sendCodexAppServerTurn(sock, threadId, text, cwd, clientUserMessageId)
}

// @@@ codex rollout on disk - the visible TUI resumes a thread via `codex --remote resume <tid>`, which reads
// the thread's ROLLOUT FILE (`<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<ts>-<tid>.jsonl`) — so a thread the
// TUI can render is exactly one whose rollout exists on disk. VERIFIED live (real codex 0.142.5): `thread/start`
// ALONE writes NO rollout — only the first fired turn materializes it; and a FRESHLY-spawned app-server accepts
// thread/start+turn but does NOT persist the rollout for its first ~2-4s (a warm-up window) — the SAME thread's
// rollout just lands a few seconds LATE (not lost). Handing the id to `resume` before then is the "no rollout
// found for thread id" failure, so codex-launch WAITS for the rollout to land before it trusts the id.
// does a rollout file for this thread id exist yet? Rollouts are grouped by date; walk day-dirs newest-first
// (lexical order = chronological on zero-padded YYYY/MM/DD) and return on first hit — the fresh rollout lives in
// the newest real dir, so the common case reads one dir. The walk is exhaustive, never capped at "the newest few
// dirs": future-dated junk under sessions/ (a test once planted 2099/12/* in the real CODEX_HOME) sorts above
// every real day-dir, and a cap let three such dirs mask ALL real rollouts — every codex launch then failed
// "persisted no rollout" with the rollout sitting on disk. A full walk is a readdir per day-dir — still cheap.
export function codexRolloutExists(threadId: string, root?: string): boolean {
  return codexRolloutPath(threadId, root) !== null
}
// The same day-dir walk, answering how big that rollout is. `thread/archive` on a LOADED thread flushes the
// thread's in-memory rollout inside the server's shutdown_and_wait before it commits, so this size IS the work
// an archive asks for; a notLoaded thread flushes nothing and its size is irrelevant. NO rollout file is a real
// `0`, not an error: a thread that has started but not yet persisted (thread/start alone writes none, and a
// fresh app-server lags 2-4s) has nothing to flush, so refusing it would be a false refusal. Only a file that
// exists and cannot be measured is unreadable, and that fails closed rather than passing as small.
export function codexRolloutBytes(threadId: string, root?: string): { bytes: number } | { unreadable: true } {
  const path = codexRolloutPath(threadId, root)
  if (path) { try { return { bytes: statSync(path).size } } catch { return { unreadable: true } } }
  return { bytes: 0 }
}

type CodexRolloutTurnSettlement = { settled: true } | { settled: false; reason: string }
const CODEX_ROLLOUT_TAIL_BYTES = 64 * 1024
const CODEX_ROLLOUT_TERMINAL_EVENTS = new Set(['task_complete', 'task_completed', 'turn_complete', 'turn_completed'])

function codexRolloutTurnSettlement(threadId: string, root?: string): CodexRolloutTurnSettlement {
  const path = codexRolloutPath(threadId, root)
  if (!path) return { settled: false, reason: 'rollout is missing' }
  let fd: number | null = null
  try {
    const size = statSync(path).size
    if (size === 0) return { settled: false, reason: 'rollout has no terminal record' }
    const length = Math.min(size, CODEX_ROLLOUT_TAIL_BYTES)
    const tail = Buffer.allocUnsafe(length)
    fd = openSync(path, 'r')
    if (readSync(fd, tail, 0, length, size - length) !== length)
      return { settled: false, reason: 'rollout tail is unreadable' }
    const line = tail.toString('utf8').split('\n').reverse().find((value) => value.trim())
    if (!line) return { settled: false, reason: 'rollout has no terminal record' }
    let event: unknown
    try { event = JSON.parse(line) } catch { return { settled: false, reason: 'rollout tail is incomplete or malformed' } }
    const payload = event && typeof event === 'object' ? (event as { payload?: unknown }).payload : null
    const terminal = event && typeof event === 'object' && (event as { type?: unknown }).type === 'event_msg' &&
      payload && typeof payload === 'object' && CODEX_ROLLOUT_TERMINAL_EVENTS.has(String((payload as { type?: unknown }).type || ''))
    return terminal ? { settled: true } : { settled: false, reason: 'rollout has no terminal record' }
  } catch {
    return { settled: false, reason: 'rollout tail is unreadable' }
  } finally {
    if (fd !== null) closeSync(fd)
  }
}
// poll until the thread's rollout lands (resume-ready) or the budget runs out. Returns false on timeout so the
// caller can FAIL LOUD instead of handing `resume` / the stored record a non-resumable id. The budget must
// exceed launch.sh's fast-fail threshold so a genuine failure exits PAST it — the retry loop then treats it as a
// real end, not a daemon race, and never sprays fresh (duplicate-prompt) threads.
export async function waitForCodexRollout(threadId: string, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (codexRolloutExists(threadId)) return true
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, 250))
  }
}

// codex's immediate poke uses the app-server JSON-RPC channel that also powers rich clients, never TUI typing.
// The visible TUI is launched against the same project app-server Unix socket, so this injects into the same
// thread the pane is showing — steering an in-progress turn or starting one if idle. A missing captured thread
// id or socket makes this poke fail; there is no tmux send-keys fallback because that reports "typed", not "accepted".
const codexPexec = promisify(execFile)
const TMUX_SOCK = process.env.SPEXCODE_TMUX || 'spexcode'
async function deliverViaCodexAppServer(rec: HarnessDeliveryRecord, text: string): Promise<DispatchResult> {
  // the socket is PER-PROJECT (the runtime root), shared by every worktree's thread; the owned thread id on
  // the record picks out THIS session's thread.
  const runtimeDir = rec.runtimeDir ?? runtimeRoot()
  let endpoint = rec.harnessSessionId ? codexEndpointForRecord(rec, runtimeDir) : currentCodexGeneration(runtimeDir)
  // A generation may be reclaimed after rotation or a host restart while the session record remains valid.
  // Repair that stale route at the delivery boundary using the same exact-thread re-pin used by resume, so an
  // accepted message is not left indefinitely in the queue just because no later human resume was requested.
  if ((!endpoint || !existsSync(endpoint.socketPath)) && rec.harnessSessionId) {
    const command = codexBaseCmd(rec.launchCmd || 'codex')
    const env = { ...process.env }
    for (const key of sessionIdentityEnvVars()) delete env[key]
    const start = async (candidate: CodexGenerationEndpoint) => {
      await spawnDetachedRuntime({ cwd: runtimeDir, logFile: candidate.logFile, pidFile: candidate.pidFile,
        receiptFile: candidate.receiptFile, command, args: ['app-server', '--listen', `unix://${candidate.socketPath}`], env })
    }
    endpoint = await resolveCodexGenerationForResume(runtimeDir, rec.session, rec.harnessSessionId, start)
  }
  if (!endpoint) return { ok: false, error: `no exact Codex generation binding for session ${rec.session} — immediate poke unavailable` }
  const sock = endpoint.socketPath
  if (!existsSync(sock)) return { ok: false, error: `no Codex app-server socket for this project — immediate poke unavailable` }
  // use the backend-owned thread id stored at launch; fall back to reading the one loaded thread only if it's
  // empty (a pre-existing session from before the id was stored).
  let threadId = rec.harnessSessionId
  if (!threadId) {
    const r = await codexThreadId(sock)
    if (!r.ok) return { ok: false, error: `${r.error} — immediate poke unavailable` }
    threadId = r.threadId
  }
  const delivered = await sendCodexAppServerTurn(sock, threadId!, text, rec.worktreePath, rec.mid)
  if (delivered.ok || rec.harness !== 'codex-headless' || !/not loaded in the app-server/u.test(delivered.error || '')) return delivered
  // Headless Codex has no TUI resume step. An idle thread can be evicted from the shared server's loaded set;
  // reload the exact rollout, then retry the same turn once. This is idempotent and does not create a new thread.
  const resumed = await codexResumeThread(sock, threadId!)
  if (!resumed.ok) return { ok: false, error: `${delivered.error}; ${resumed.error}` }
  return sendCodexAppServerTurn(sock, threadId!, text, rec.worktreePath, rec.mid)
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

// @@@ stripCodexTrustFor - remove EVERY prior definition of THIS project's codex trust from a config.toml body,
// in ANY form: our own sentinel block (whatever past format its comments used), a BARE `[projects."<proj>"]`
// table (codex AUTO-writes one the moment it trusts a folder interactively/`exec` — NOT sentinel-wrapped), and
// any `[hooks.state."<hooksJson>:…"]` tables. This is what makes the UNCONDITIONAL write duplicate-SAFE and
// SELF-HEALING: codex REFUSES to load a config.toml with a duplicate key ("duplicate key"), so a sentinel-only
// replace (the old behaviour) that missed a pre-existing bare/old block APPENDED a second `[projects."<proj>"]`
// and took codex fully OFFLINE (the real cause of the public-vps outage). It is TABLE-scoped and STRING-compared
// (no regex escaping of the path), so other projects' trust, the shared parent tables (`[projects]`,
// `[hooks.state]`), and every other config key are untouched; a skipped table's body ends at the next header,
// blank, or comment, so a user comment attached to a following table is preserved.
function stripCodexTrustFor(cur: string, proj: string, hooksJson: string): string {
  const projHeader = `[projects."${proj}"]`
  const hooksPrefix = `[hooks.state."${hooksJson}:`
  const out: string[] = []
  let skip = false
  for (const line of cur.split('\n')) {
    const t = line.trim()
    const isHeader = /^\[\[?/.test(t)                       // a TOML table / array-of-tables header
    if (skip) { if (t === '' || t.startsWith('#') || isHeader) skip = false; else continue }   // end THIS table's body
    if (isHeader && (t === projHeader || t.startsWith(hooksPrefix))) { skip = true; continue }
    if (t === `# spexcode:trust:${proj} (managed — do not edit)` || t === `# spexcode:trust:end:${proj}`) continue
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n*$/, '')
}

// @@@ assertCodexConfigParses - ~/.codex/config.toml has TWO uncoordinated writers, codex itself and this adapter,
// and neither rewrite is something the other waits for. A body read mid-write (a line cut short) or one already
// broken must never be written back: codex refuses the whole file, and every dispatched thread then dies at
// config load. The check is on the bytes about to land, so stripping this project's own duplicate still heals.
function assertCodexConfigParses(file: string, body: string): void {
  try { parseToml(body) } catch (error) {
    throw new Error(`refusing to rewrite ${file}: it does not parse as TOML (${error instanceof Error ? error.message : String(error)}); the file is broken or another writer is mid-write — repair it, then rerun`)
  }
}

// additively stamp PROJECT trust (`[projects."<proj>"] trust_level = "trusted"`) AND the per-hook
// `trusted_hash` blocks for each event into the user's GLOBAL ~/.codex/config.toml, so a dispatched or
// self-launched codex trusts THIS project's config layer (enabling hook discovery) AND treats each hook as
// already-reviewed (no "Hooks need review" prompt on a persistent resume — see writeTrust). ALL prior
// definitions of this project's trust (ours, bare, or old-format) are STRIPPED first, so the write can never
// leave a DUPLICATE key (which breaks codex config loading) and self-heals a config that already carried one.
// Scoped to THIS project path; never touches the user's other config. CODEX_HOME respected for testability.
// (`events` may be empty for a trust-only stamp in tests.)
export function writeCodexTrust(proj: string, events: readonly string[], cmdFor: (e: string) => string): string {
  const home = process.env.CODEX_HOME || join(homedir(), '.codex')
  const file = join(home, 'config.toml')
  const hooksJson = join(proj, '.codex', 'hooks.json')
  const lines = [`[projects."${proj}"]`, 'trust_level = "trusted"']
  for (const e of events) {
    const snake = SNAKE[e]
    lines.push(`[hooks.state."${hooksJson}:${snake}:0:0"]`, `trusted_hash = "${codexHookHash(snake, cmdFor(e))}"`)
  }
  const blk = `# spexcode:trust:${proj} (managed — do not edit)\n${lines.join('\n')}\n# spexcode:trust:end:${proj}`
  const cleaned = stripCodexTrustFor(existsSync(file) ? readFileSync(file, 'utf8') : '', proj, hooksJson)
  const next = cleaned ? `${cleaned}\n\n${blk}\n` : `${blk}\n`
  assertCodexConfigParses(file, next)
  if (!existsSync(home)) mkdirSync(home, { recursive: true })
  writeFileIfChanged(file, next)
  return file
}

// the inverse of writeCodexTrust: strip THIS project's codex trust from the GLOBAL config.toml — the SAME
// removal writeCodexTrust does before it writes, so uninstall fully clears our trust (sentinel, bare, and
// hooks.state) and can never leave a half-block. No-op when the file/nothing-of-ours is absent (so it never
// rewrites/normalizes a config that carries none of our trust). CODEX_HOME respected for testability.
function removeCodexTrust(proj: string): void {
  const home = process.env.CODEX_HOME || join(homedir(), '.codex')
  const file = join(home, 'config.toml')
  if (!existsSync(file)) return
  const hooksJson = join(proj, '.codex', 'hooks.json')
  const cur = readFileSync(file, 'utf8')
  if (!cur.includes(`[projects."${proj}"]`) && !cur.includes(`[hooks.state."${hooksJson}:`) &&
      !cur.includes(`# spexcode:trust:${proj} `) && !cur.includes(`# spexcode:trust:end:${proj}`)) return
  const cleaned = stripCodexTrustFor(cur, proj, hooksJson)
  const next = cleaned ? `${cleaned}\n` : ''
  assertCodexConfigParses(file, next)
  writeFileIfChanged(file, next)
}


// ---------------------------------------------------------------------------------------------------------
// codex per-session liveness signal — a codex process live in the pane's DESCENDANT tree, NOT the pane's
// foreground command name, and NOT the shared app-server socket.

// @@@ paneTreeRunsCodex - the codex TUI is alive iff a codex-ish process is live SOMEWHERE in the launch
// pane's descendant process tree. The pane's FOREGROUND name is NOT the signal: the pane runs
// `bash <launch.sh>` → `bash -lc <codex script>` → node (the codex CLI) → the vendored `codex` binary, and
// tmux's `pane_current_command` reports the OUTERMOST of those — `bash` — for the entire life of a healthy,
// rendering TUI (field-confirmed on macmini and Linux). So "foreground == codex" false-read every live codex
// as offline, and the earlier sock-presence check false-read a dead one as online (the SHARED per-project
// app-server socket survives a failed `--remote resume`). The honest shape test: HEALTHY = codex (by whatever
// name — `codex`, the vendored musl binary, or the `node` its CLI runs under) exists among the pane pid's
// descendants; FAILED = the launch script's bounded retries exhausted, everything under the pane exited, and
// the pane sits at the bare shell — no codex/node anywhere below it. The walk is over ONE whole-box
// pid→(ppid, comm) snapshot the caller took (a single `ps` for the whole session list); missing probe data
// (tmux/ps couldn't report) is not-live, and the caller's boot grace still shows a fresh launch — whose tree
// may not yet contain codex — as 'starting', not 'offline'.
const CODEX_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const
const codexBaseCmd = (cmd?: string) => cmd || 'codex'
function codexHeadlessLaunchCommandLocal(id: string, codexCmd = 'codex', dir?: string): string {
  return codexLaunchCommand(id, codexCmd, undefined, dir, false)
}
function codexRuntimeDescriptor(endpoint: CodexGenerationEndpoint, runtimeDir: string): SharedRuntimeDescriptor {
  return {
    key: codexDescriptorKey(endpoint),
    label: endpoint.id === 'legacy' ? 'Codex app-server' : `Codex app-server ${endpoint.id.slice(0, 18)}`,
    pidFile: endpoint.pidFile,
    receiptFile: endpoint.receiptFile,
    residency: async () => {
      let pid = 0
      try { pid = Number(readFileSync(endpoint.pidFile, 'utf8').trim()) } catch { /* stale/missing pid */ }
      const pidLive = pid > 0 && !!processStartToken(pid)
      const listener = await listenerAt(endpoint.socketPath, 800)
      if (!pidLive && listener === 'dead') return { healthy: true, referenceIds: [], rootAbsent: true }
      if (pidLive && (!codexRuntimeGeneration(runtimeDir, endpoint) || listener !== 'live'))
        return { healthy: false, referenceIds: [], error: 'Codex shared root identity/socket generation is not proven' }
      if (!pidLive || listener !== 'live')
        return { healthy: false, referenceIds: [], error: 'Codex shared root state is unknown' }
      const result = await codexLoadedReferenceIds(endpoint.socketPath)
      return result.ok ? { healthy: true, referenceIds: result.referenceIds } : { healthy: false, referenceIds: [], error: result.error }
    },
    mutationGuard: (targetReferenceId, opts) => codexMutationGuard(targetReferenceId, runtimeDir, opts, endpoint),
    probe: (referenceIds) => {
      // A draining generation keeps serving its bound sessions but is no longer a control-plane candidate.
      // Listing loaded ids preserves ownership evidence; reading native turn state on that old server only
      // adds load and can time out while the current generation is healthy.
      const generation = readCodexGenerationLedger(runtimeDir).generations[endpoint.id]
      return codexSharedRuntimeProbe(runtimeDir, endpoint, generation?.state === 'draining' ? [] : referenceIds)
    },
  }
}

function codexRuntimeDescriptors(runtimeDir: string): SharedRuntimeDescriptor[] {
  const endpoints = codexGenerationEndpoints(runtimeDir)
  return (endpoints.length ? endpoints : [legacyCodexGenerationEndpoint(runtimeDir)])
    .map((endpoint) => codexRuntimeDescriptor(endpoint, runtimeDir))
}

function codexResumeArg(rec: { session: string; harnessSessionId?: string | null }, pendingLaunchPayload?: string | null): string {
  if (rec.harnessSessionId) return `--resume ${rec.harnessSessionId}`
  if (pendingLaunchPayload == null)
    throw new Error(`session ${rec.session}: native identity is absent and the authoritative resolved launch payload is missing; refusing to create an empty thread`)
  return shQuote(pendingLaunchPayload)
}

export const codexHarness: Harness = {
  id: 'codex',
  launchPayloadProof: true,
  dispatchId: 'codex',
  headless: false,
  sharedRuntimeSpawn: true,
  events: CODEX_EVENTS,
  ownsRendezvous: false,                             // no rendezvous daemon — liveness + prompts through the project app-server socket
  paneTitleIsSelfSummary: false,                     // codex's pane title is a spinner + the cwd folder name, NOT a task summary → headline uses the prompt
  transcript: codexTranscript,
  launchCmd: (id, runtimeDir, cmd) => codexLaunchCommand(id, codexBaseCmd(cmd), undefined, runtimeDir ?? runtimeRoot()),   // the full app-server+TUI script BUILT AROUND the resolved base command; ONE app-server per PROJECT
  baseCmd: codexBaseCmd,
  oneShotTurn: (prompt, cmd) => ({ command: `${codexBaseCmd(cmd)} exec -`, stdin: prompt }),   // `exec -` reads the prompt from stdin

  sessionIdArg: () => '',                            // codex assigns its own id (the backend owns it via thread/start)
  sessionEnvVar: harnessIdentity('codex').sessionEnvVar,
  launchEnv: noLaunchEnv,
  // Codex discovers a LINKED worktree's PROJECT hooks from the ROOT CHECKOUT's `.codex`, NOT the worktree's
  // (codex-rs `root_checkout_hooks_folder_for_dir` rewrites the hooks-config folder to <repo_root>/<rel>/.codex
  // for any linked worktree). Every worktree's thread (cwd = worktree root) therefore reads the SAME
  // <mainCheckout>/.codex/hooks.json — so the codex hooks shim + its trust materialize at the MAIN checkout
  // (one per project, mirroring the per-project runtime tier), while the AGENTS.md contract + skills stay
  // per-worktree (codex loads THOSE by walking the thread cwd). dispatch.sh resolves `proj` from the thread
  // cwd, so one shared shim serves every worktree.
  shimFile: (proj) => join(mainCheckout(proj), '.codex', 'hooks.json'),
  shimScope: 'project',
  shimOwnership: 'shared-json',
  // a LINKED worktree also needs its OWN `.codex/hooks.json` so codex-rs anchors the project config layer for
  // the worktree cwd (without a `.codex/` under the worktree root, codex builds no layer, so the rewritten
  // root-checkout hooks are never discovered and NO hooks fire — bypass_hook_trust cannot rescue a layer that
  // was never built). Its content is ignored (the rewrite reads the root's shim above), so it is a pure anchor.
  // Only for a genuine worktree: on the main checkout, shimFile already wrote `.codex/hooks.json` there.
  worktreeHookAnchor: (proj) => (mainCheckout(proj) === proj ? null : join(proj, '.codex', 'hooks.json')),
  contractFiles: (proj) => [join(proj, 'AGENTS.md')],
  skillDir: (proj) => join(proj, '.codex', 'skills'),
  agentDir: () => null,                              // codex has no file-discovered agent-definition primitive — materialize skips it
  shim: (dispatch, spex) => buildShim('codex', CODEX_EVENTS, dispatch, spex),
  // Write the FULL codex trust — BOTH tiers, UNCONDITIONALLY — because `bypass_hook_trust` covers neither on
  // the dispatched-worker path:
  //   (1) PROJECT trust (`[projects."<mainCheckout>"] trust_level = "trusted"`) ENABLES the project config
  //       layer — the precondition for codex to DISCOVER our hooks AT ALL. codex-rs `get_layers` drops a
  //       disabled (untrusted) project layer BEFORE hook discovery runs, and bypass_hook_trust is read only
  //       AFTER, per-handler — so it can NEVER enable a layer. A dispatched worker's app-server does NOT
  //       auto-trust the project (only the interactive TUI / `codex exec` approval flow does), so without this
  //       an untrusted worktree thread fires ZERO hooks ("Project-local config, hooks … are disabled until the
  //       project is trusted").
  //   (2) per-HOOK trust (the reverse-engineered `trusted_hash` blocks — codexHookHash) marks each hook Trusted
  //       so it is NOT "new or changed". This is REQUIRED even though the launch carries
  //       `--dangerously-bypass-hook-trust`: our visible TUI attaches to the backend-owned thread via `codex …
  //       resume <tid>`, and codex-rs FORCES the startup hook-review prompt on a PERSISTENT RESUME regardless of
  //       the flag (`bypass_hook_trust_for_startup_review = config.bypass_hook_trust && !is_persistent_resume`,
  //       tui/src/lib.rs) — an untrusted/modified hook (no matching hash) leaves the worker WEDGED at an
  //       interactive "Hooks need review" menu. Matching hashes make review_needed_count == 0, so codex skips
  //       the prompt and the worker runs unattended. bypass_hook_trust stays on `thread/start` + the resume flag
  //       as DEFENCE for the non-resume paths (and if a version bump makes a hash mismatch, the app-server
  //       thread still runs the hooks); it does not REPLACE the hashes here.
  writeTrust: (proj, cmdFor) => [writeCodexTrust(mainCheckout(proj), CODEX_EVENTS, cmdFor)],
  // trust is keyed by the MAIN checkout (where the codex shim materializes) — strip it at the same key.
  removeTrust: (proj) => removeCodexTrust(mainCheckout(proj)),
  clean(proj, arts, preserveProject) { cleanHarness(this, proj, arts, preserveProject) },
  slashCommands: codexSlashCommands,
  // online iff the tmux window is up AND the agent is live. PRIMARY: the launch-registered `agent.pid` hot-tier
  // verdict (`pidAlive`) — a 100ms syscall (kill-0), no ps scan. LEGACY: a pre-registration session has no
  // agent.pid (`pidAlive` undefined) → fall back to the whole-box ps DESCENDANT-tree walk (paneTreeRunsCodex):
  // a codex-ish process live below the pane pid, NOT the pane's foreground command (that is `bash`, the launch
  // wrapper, even while the TUI renders — the field-confirmed false-OFFLINE) and NOT the app-server socket
  // (SHARED per-project, it survives a failed `--remote resume` — the earlier false-ONLINE). The legacy path
  // self-extinguishes as pre-registration sessions close.
  liveness: (_rec, tmuxAlive, _runtimeDir, pane) => {
    if (!tmuxAlive) return 'offline'
    if (pane?.pidAlive !== undefined) return pane.pidAlive ? 'online' : 'offline'
    return paneTreeRunsCodex(pane) ? 'online' : 'offline'
  },
  exactNativeTargetId: (rec) => rec.harnessSessionId || null,
  deliver: (rec, text) => deliverViaCodexAppServer(rec, text),
  observeTurnFailures: codexTurnFailureObserver,
  interrupt: interruptCodexTurn,
  cleanupRuntime: async () => { /* project-scoped app-server is shared; no per-session transport to remove */ },
  targetDescriptorKey: (rec) => {
    const endpoint = codexEndpointForRecord(rec, runtimeRoot(), true)
    return endpoint ? codexDescriptorKey(endpoint) : null
  },
  coldRetirementPreflight: async (rec) => {
    if (!rec.harnessSessionId) return { ok: false, reason: 'no exact Codex thread identity is registered' }
    const threadId = rec.harnessSessionId
    const dir = runtimeRoot()
    const endpoint = codexEndpointForRecord(rec, dir)
    if (!endpoint) return { ok: false, reason: 'no exact Codex generation binding is registered for this target' }
    const result = await codexColdPreflight(threadId, dir, undefined, endpoint)
    if (!result.ok) return result
    const generationBefore = result.receipt.generation
    if (codexRuntimeGeneration(dir, endpoint) !== generationBefore)
      return { ok: false, reason: 'shared Codex app-server generation changed during cold retirement guard' }
    if (!result.alreadyCold)
      return { ok: false, reason: `Codex target subtree ${result.receipt.activeIds.join(', ')} is not fully archived` }
    return { ok: true, alreadyCold: true }
  },
  coldPreflight: async (rec) => {
    if (!rec.harnessSessionId) return { ok: false, reason: 'no exact Codex thread identity is registered' }
    const dir = runtimeRoot()
    const binding = resolveCodexGenerationForClose(dir, rec.session, rec.harnessSessionId)
    if (binding?.gone) {
      return { ok: true, alreadyCold: true }
    }
    const endpoint = binding?.endpoint ?? codexEndpointForRecord(rec, dir)
    return endpoint ? codexColdPreflight(rec.harnessSessionId, dir, undefined, endpoint)
      : { ok: false, reason: 'no exact Codex generation binding is registered for this target' }
  },
  coldRuntime: async (rec, suppliedReceipt) => {
    if (!rec.harnessSessionId) return { ok: false, reason: 'no exact Codex thread identity is registered' }
    const threadId = rec.harnessSessionId
    const dir = runtimeRoot()
    const binding = resolveCodexGenerationForClose(dir, rec.session, threadId)
    if (binding?.gone) {
      prepareCodexGenerationClose(dir, rec.session, threadId)
      return { ok: true }
    }
    const endpoint = binding?.endpoint ?? codexEndpointForRecord(rec, dir)
    if (!endpoint) return { ok: false, reason: 'no exact Codex generation binding is registered for this target' }
    const sock = endpoint.socketPath
    if (suppliedReceipt !== undefined && (!isCodexColdPlan(suppliedReceipt) || suppliedReceipt.threadId !== threadId))
      return { ok: false, reason: 'Codex cold teardown receipt is missing, malformed, or names a different target' }
    const frozenPlan = isCodexColdPlan(suppliedReceipt) ? suppliedReceipt : null
    if (frozenPlan && (frozenPlan.endpoint.id !== endpoint.id || codexRuntimeGeneration(dir, endpoint) !== frozenPlan.generation))
      return { ok: false, reason: 'shared Codex app-server generation changed after archive preflight' }
    const preflight = await codexColdPreflight(threadId, dir, frozenPlan?.generation, endpoint)
    if (!preflight.ok) return preflight
    const plan = frozenPlan ?? preflight.receipt
    if (frozenPlan && (!sameIdSet(frozenPlan.descendantIds, preflight.receipt.descendantIds) ||
      !sameParentEdges(frozenPlan.parentEdges, preflight.receipt.parentEdges) ||
      !sameIdSet(frozenPlan.activeIds, preflight.receipt.activeIds) ||
      !sameIdSet(frozenPlan.archivedIds, preflight.receipt.archivedIds)))
      return { ok: false, reason: 'Codex target subtree ownership or collection assignment changed after archive preflight' }
    if (codexRuntimeGeneration(dir, endpoint) !== plan.generation)
      return { ok: false, reason: 'shared Codex app-server generation changed during target subtree guard' }
    if (plan.activeIds.length === 0) return { ok: true }
    const subtreeSet = new Set(plan.subtreeIds)
    const siblingBefore = plan.guard.referenceIds.filter((referenceId) => !subtreeSet.has(referenceId))
    const fence = { dir, endpoint, generation: plan.generation }

    const compensate = async (reason: string): Promise<{ ok: false; reason: string }> => {
      const restored = await codexRestoreColdPlan(plan, dir)
      return { ok: false, reason: restored.ok ? reason : `${reason}; ${restored.reason}` }
    }

    const coldCheck = async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
      const after = await codexColdPreflight(threadId, dir, plan.generation, endpoint)
      if (!after.ok) return after
      if (codexRuntimeGeneration(dir, endpoint) !== plan.generation) return { ok: false, reason: 'shared Codex app-server generation changed during archive' }
      if (!sameIdSet(plan.descendantIds, after.receipt.descendantIds) || !sameParentEdges(plan.parentEdges, after.receipt.parentEdges))
        return { ok: false, reason: `Codex target descendant closure changed during archive (before=${plan.descendantIds.join(', ')}; after=${after.receipt.descendantIds.join(', ')})` }
      if (after.receipt.activeIds.length)
        return { ok: false, reason: `Codex target subtree remains in the active collection (${after.receipt.activeIds.join(', ')})` }
      if (plan.unmaterialized) {
        if (after.receipt.archivedIds.length || after.receipt.guard.referenceIds.includes(threadId))
          return { ok: false, reason: 'unmaterialized Codex target remains in native state after delete' }
        return { ok: true }
      }
      if (!sameIdSet(plan.subtreeIds, after.receipt.archivedIds))
        return { ok: false, reason: 'Codex target subtree is not uniquely archived after cold teardown' }
      const afterIds = new Set(after.receipt.guard.referenceIds.filter((referenceId) => !subtreeSet.has(referenceId)))
      if (siblingBefore.some((referenceId) => !afterIds.has(referenceId))) return { ok: false, reason: 'a pre-existing shared Codex sibling reference disappeared during archive' }
      return { ok: true }
    }
    const loadedSet = new Set(plan.guard.referenceIds)
    for (const id of plan.activeIds) {
      // Only a loaded member pays the rollout flush, and an unreadable size must not become a small budget,
      // so it fails closed before the server is asked to mutate anything.
      let budgetMs = CODEX_MUTATION_BASE_MS
      if (loadedSet.has(id) && !plan.unmaterialized) {
        const rollout = codexRolloutBytes(id)
        if ('unreadable' in rollout) return compensate(`Codex subtree member ${id} is loaded and its rollout exists but cannot be measured, so the archive flush budget is unknown`)
        budgetMs = codexArchiveBudgetMs(rollout.bytes)
      }
      const archived = await codexThreadMutation(sock, plan.unmaterialized ? 'thread/delete' : 'thread/archive', id, fence, undefined, budgetMs)
      if (archived.ok) continue
      const action = plan.unmaterialized ? 'deleting' : 'archiving'
      const reason = `${archived.error} while ${action} Codex subtree member ${id}`
      // Compensating an unknown commit is what turns one slow member into a false "compensation failed": the
      // unarchive queues behind an archive the server is still executing and times out too. Report the unknown
      // commit instead — that is the recovery token resume already reconciles.
      if (archived.commit === 'unknown') return { ok: false, reason: `${reason}; commit state is unknown and no compensation was attempted` }
      return compensate(reason)
    }
    let verified: { ok: true } | { ok: false; reason: string } = { ok: false, reason: 'Codex archive verification timed out' }
    const verifyDeadline = Date.now() + 30_000
    for (let attempt = 0; attempt < 6 && Date.now() < verifyDeadline; attempt++) {
      verified = await coldCheck()
      if (verified.ok) break
      if (Date.now() < verifyDeadline) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (verified.ok) return verified
    return compensate(verified.reason)
  },
  quarantineOrphanThread: codexQuarantineOrphanThread,
  restoreRuntime: async (rec, suppliedReceipt) => {
    if (!rec.harnessSessionId) return { ok: false, reason: 'no exact Codex thread identity is registered' }
    if (suppliedReceipt !== undefined) {
      if (!isCodexColdPlan(suppliedReceipt) || suppliedReceipt.threadId !== rec.harnessSessionId)
        return { ok: false, reason: 'Codex cold compensation receipt is invalid or names a different target' }
      if (suppliedReceipt.unmaterialized) return { ok: true }
      return codexRestoreColdPlan(suppliedReceipt)
    }
    const endpoint = codexEndpointForRecord(rec)
    if (!endpoint) return { ok: false, reason: 'no exact Codex generation binding is registered for this target' }
    const sock = endpoint.socketPath
    const reconcile = async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
      const [active, archived] = await Promise.all([
        codexThreadList(sock, { archived: false, sourceKinds: [] }),
        codexThreadList(sock, { archived: true, sourceKinds: [] }),
      ])
      if (!active.ok || !archived.ok) return { ok: false, reason: 'Codex restore state could not be reconciled' }
      const inActive = active.ids.includes(rec.harnessSessionId!)
      const inArchived = archived.ids.includes(rec.harnessSessionId!)
      if (inActive && !inArchived) return { ok: true }
      if (inArchived && !inActive) return { ok: false, reason: 'Codex thread remains archived; restore can be retried' }
      return { ok: false, reason: 'Codex restore state is ambiguous (thread in both or neither collection)' }
    }
    const restored = await codexThreadMutation(sock, 'thread/unarchive', rec.harnessSessionId)
    if (!restored.ok) return reconcile()
    return reconcile()
  },
  sharedRuntimes: codexRuntimeDescriptors,
  // owned thread id → `--resume <id>` MARKER the codex launch script reads to resume that thread DIRECTLY (NOT
  // a tail handed to a bare `codex` — the script's final `codex … resume "$tid"` performs codex's own resume on
  // the owned id, the SAME conversation); no identity → replay the authoritative resolved launch payload.
  resumeArg: codexResumeArg,
  // codex's own settled failure: a thread id whose rollout is not on disk can never be resumed, so the launch
  // that says so has already decided. (Its transient sibling — the rollout still being written — is handled
  // BEFORE launch by waitForCodexRollout, so what reaches here is the permanent case.)
  fatalLaunchOutput: ['no rollout found for thread id'],
}

type CodexHeadlessLaunchReadinessProof = Readonly<{
  kind: 'codex-headless-shared-runtime'
  descriptorKey: string
  generation: CodexRuntimeGenerationProof
  target: Readonly<{
    sessionId: string
    threadId: string
    ownerSessionId: string
    ownerCount: 1
    ownerState: 'governed'
    referenceState: 'loaded'
    protectsControlPlane: true
  }>
}>

const sameCodexHeadlessReadinessProof = (left: CodexHeadlessLaunchReadinessProof, right: CodexHeadlessLaunchReadinessProof) =>
  left.kind === right.kind &&
  left.descriptorKey === right.descriptorKey &&
  codexRuntimeGenerationToken(left.generation) === codexRuntimeGenerationToken(right.generation) &&
  left.target.sessionId === right.target.sessionId &&
  left.target.threadId === right.target.threadId &&
  left.target.ownerSessionId === right.target.ownerSessionId &&
  left.target.ownerCount === right.target.ownerCount &&
  left.target.ownerState === right.target.ownerState &&
  left.target.referenceState === right.target.referenceState &&
  left.target.protectsControlPlane === right.target.protectsControlPlane

const governedSharedRuntimeOwners = (runtimeDir: string, descriptorKey: string, threadId: string, excludingSessionId?: string): string[] | null => {
  const root = join(runtimeDir, 'sessions')
  let entries
  try { entries = readdirSync(root, { withFileTypes: true }) }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? [] : null }
  const owners: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === excludingSessionId) continue
    let parsed: unknown
    try { parsed = JSON.parse(readFileSync(join(root, entry.name, 'runtime.json'), 'utf8')) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      return null
    }
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as { session_id?: unknown; governed?: unknown; harness?: unknown; harness_session_id?: unknown }
    if (typeof record.session_id !== 'string') return null
    if (record.governed !== true) continue
    const harnessId = typeof record.harness === 'string' && record.harness ? record.harness : 'claude'
    let sharesDescriptor = false
    try { sharesDescriptor = (harnessId === 'codex' || harnessId === 'codex-headless') && descriptorKey.startsWith('codex-app-server') }
    catch { return null }
    if (sharesDescriptor && record.harness_session_id === threadId) owners.push(record.session_id)
  }
  return owners
}

async function codexHeadlessReadinessProof(current: () => HarnessLaunchReadyRecord | null): Promise<CodexHeadlessLaunchReadinessProof | null> {
  const record = current()
  if (!record?.governed || record.stopped || record.archived || !record.harnessSessionId) return null
  const endpoint = codexEndpointForRecord(record, record.runtimeDir)
  if (!endpoint) return null
  const descriptor = codexHeadlessHarness.sharedRuntimes?.(record.runtimeDir)
    .find((candidate) => candidate.key === codexDescriptorKey(endpoint))
  if (!descriptor) return null
  const generationBefore = codexRuntimeGenerationProof(record.runtimeDir, endpoint)
  if (!generationBefore) return null
  if (!descriptor.residency) return null
  let resident: Awaited<ReturnType<NonNullable<typeof descriptor.residency>>>
  try { resident = await descriptor.residency() }
  catch { return null }
  if (!resident.healthy) return null
  if (!resident.referenceIds.includes(record.harnessSessionId)) return null
  const owners = governedSharedRuntimeOwners(record.runtimeDir, descriptor.key, record.harnessSessionId)
  if (!owners || owners.length !== 1 || owners[0] !== record.session) return null
  const generationAfter = codexRuntimeGenerationProof(record.runtimeDir, endpoint)
  if (!generationAfter || codexRuntimeGenerationToken(generationBefore) !== codexRuntimeGenerationToken(generationAfter)) return null
  return Object.freeze({
    kind: 'codex-headless-shared-runtime',
    descriptorKey: descriptor.key,
    generation: generationAfter,
    target: Object.freeze({
      sessionId: record.session,
      threadId: record.harnessSessionId,
      ownerSessionId: owners[0],
      ownerCount: 1,
      ownerState: 'governed',
      referenceState: 'loaded',
      protectsControlPlane: true,
    }),
  })
}

// Codex headless is an independent adapter: its materialization and app-server delivery are exactly Codex's,
// while launch only runs the backend-owned thread/start + first turn. There is no TUI to attach after that turn;
// the shared project app-server keeps the thread addressable and idle sends use the inherited JSON-RPC channel.
export const codexHeadlessHarness: Harness = {
  ...codexHarness,
  id: 'codex-headless',
  launchPayloadProof: true,
  sessionEnvVar: harnessIdentity('codex-headless').sessionEnvVar,
  headless: true,
  runtimeOwnership: 'adapter',
  launchOneShot: true,
  launchCmd: (id, runtimeDir, cmd) => codexHeadlessLaunchCommandLocal(id, codexBaseCmd(cmd), runtimeDir ?? runtimeRoot()),
  // A headless thread has no pane to witness it. The shared app-server generation is therefore the adapter's
  // minimum liveness witness: a stale session record must not keep a dead project runtime online forever. The
  // session layer adds the one exact loaded-reference census before publishing this reading on the board.
  liveness: (rec, _tmuxAlive, runtimeDir) => {
    if (rec.stopped || rec.archived || !rec.harnessSessionId) return 'offline'
    const endpoint = codexEndpointForRecord(rec, runtimeDir ?? runtimeRoot())
    return endpoint && codexRuntimeGenerationProof(runtimeDir ?? runtimeRoot(), endpoint) ? 'online' : 'offline'
  },
  launchReady: async (current, deadline) => {
    for (;;) {
      const proof = await codexHeadlessReadinessProof(current)
      if (proof) return {
        proof,
        validate: async (latest) => {
          const currentProof = await codexHeadlessReadinessProof(latest)
          return !!currentProof && sameCodexHeadlessReadinessProof(proof, currentProof)
        },
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0) return null
      await new Promise((resolve) => setTimeout(resolve, Math.min(200, remaining)))
    }
  },
  // There is no TUI to restart and the project app-server keeps an identified thread addressable. A pre-identity
  // recovery still replays the authoritative resolved launch payload through codex-launch.
  resumeArg: codexResumeArg,
}
