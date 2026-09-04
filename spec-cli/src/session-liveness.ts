// @@@ probe layer, no lifecycle - this module derives whether an agent is addressable and NOTHING else: it
// opens no record for writing and authors no status. `reconcile` deliberately stayed in sessions.ts, because
// joining this reading onto the lifecycle the agent wrote is [[state]]'s question, not this one's — which is
// what leaves this module importing no runtime value from sessions.ts at all. [[liveness]] has the tier,
// witness, and fail-loud rules the code below implements.
import { readFileSync, statSync } from 'node:fs'
import { processStartToken, runtimeRoot, sessionArtifactPath, listSessionIds } from '@spexcode/spec-core'
import {
  defaultHarness, harnessById, procSnapshot, rendezvousListening,
  type Harness, type PaneProbe,
} from './harness.js'
import { TMUX_PROBE_TIMEOUT_MS, TARGET_PROBE_TIMEOUT_MS, sessionHost, probeTimedOut } from './session-host.js'
import { readRecord, SessionRecordUnusable, type SessRec } from './session-record.js'

// The reading this module produces. It lives here rather than in the session core because it is this
// module's own answer; every other file reads it as a type imported FROM the prober.
export type Liveness = 'online' | 'starting' | 'offline' | 'unknown'

// Share one liveness snapshot rather than spawning tmux for every displayed session.
export type LiveSnap = { probeFailed: boolean; windows: Map<string, PaneProbe>; titles: Map<string, string>; sockets: Set<string>; unproven: Set<string> }

// tmux rewrites CONTROL characters in a format string before printing them — 3.6a turns both a tab and a raw
// 0x1f into `_`, while 3.4 turns a raw 0x1f into the printable escape `\037`. So the field separator is ASKED
// FOR as that printable text, which every supported version passes through untouched, and the format is built
// from the same constant the parser splits on: the two can no longer disagree about what tmux actually emits.
const TMUX_PANE_SEPARATOR = '\\037'
export const TMUX_PANE_FORMAT = `#{session_name}${TMUX_PANE_SEPARATOR}#{pane_pid}${TMUX_PANE_SEPARATOR}#{pane_title}`

// First pane per session wins; split only twice so titles may contain the field separator.
export function parseLivePanes(out: string): Map<string, { panePid?: number; title?: string }> {
  const m = new Map<string, { panePid?: number; title?: string }>()
  for (const line of out.split('\n')) {
    if (!line) continue
    // Accept the former tab shape for callers replaying old snapshots; tmux itself emits TMUX_PANE_SEPARATOR.
    const separator = line.includes(TMUX_PANE_SEPARATOR) ? TMUX_PANE_SEPARATOR : '\t'
    const t1 = line.indexOf(separator)
    const name = (t1 < 0 ? line : line.slice(0, t1)).trim()
    if (!name || m.has(name)) continue   // first pane per session wins
    if (t1 < 0) { m.set(name, {}); continue }
    const rest = line.slice(t1 + separator.length)
    const t2 = rest.indexOf(separator)
    const pid = Number((t2 < 0 ? rest : rest.slice(0, t2)).trim())
    const title = t2 < 0 ? '' : rest.slice(t2 + separator.length)
    m.set(name, { panePid: Number.isFinite(pid) && pid > 0 ? pid : undefined, title: title || undefined })
  }
  return m
}

// Latch ESRCH per pid-file mtime so a recycled OS PID cannot revive an old session.
type PidEntry = { mtimeMs: number; pid: number; deadLatched: boolean }
const pidRegistry = new Map<string, PidEntry>()
export function readAgentPid(p: string): number { try { return Number(readFileSync(p, 'utf8').trim()) } catch { return NaN } }
export function agentAlive(id: string): boolean | undefined {
  if (sessionHost().kind === 'process-host') {
    const identity = sessionHost().witness(id)
    return !identity || typeof identity === 'string' ? false : processStartToken(identity.pid) === identity.startToken
  }
  const pidPath = sessionArtifactPath(id, 'agent.pid')
  let mtimeMs: number
  try { mtimeMs = statSync(pidPath).mtimeMs } catch { pidRegistry.delete(id); return undefined }   // no pid file → pre-registration
  let e = pidRegistry.get(id)
  if (!e || e.mtimeMs !== mtimeMs) { e = { mtimeMs, pid: readAgentPid(pidPath), deadLatched: false }; pidRegistry.set(id, e) }
  if (e.deadLatched) return false                                     // latched dead stays dead until a new write (fresh mtime)
  if (!Number.isFinite(e.pid) || e.pid <= 0) return false
  try { process.kill(e.pid, 0); return true }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return true  // alive but not ours to signal
    e.deadLatched = true                                             // ESRCH → proven dead, latch it permanently
    return false
  }
}

// Only pre-agent.pid Codex sessions need the legacy whole-process scan.
export function needsCodexProcScan(windowed: { harness: string; hasPid: boolean }[]): boolean {
  return windowed.some((w) => (w.harness || 'claude') === 'codex' && !w.hasPid)
}

export async function liveSnapshot(targetId?: string): Promise<LiveSnap> {
  const windows = new Map<string, PaneProbe>()
  const titles = new Map<string, string>()
  if (sessionHost().kind === 'process-host') {
    // process-host has no window/pane census. Per-session process identity is joined by liveness().
    return { probeFailed: false, windows, titles, sockets: new Set(), unproven: new Set() }
  }
  let out: string
  try {
    // ONE merged spawn replaces the old two (list-sessions + list-panes): window presence + pane pid + title.
    // A target-scoped close probe avoids unrelated panes turning a safe close into a global timeout.
    const args = targetId
      ? ['list-panes', '-t', targetId, '-F', TMUX_PANE_FORMAT]
      : ['list-panes', '-a', '-F', TMUX_PANE_FORMAT]
    out = await sessionHost().command(args, targetId ? TARGET_PROBE_TIMEOUT_MS : TMUX_PROBE_TIMEOUT_MS)
  } catch (e) {
    // a TIMEOUT/kill is a probe FAILURE (we can't tell who's alive → unknown, never a false graveyard). A clean
    // non-zero exit ("no server running" — genuinely zero sessions) is authoritative → the empty map = offline.
    return { probeFailed: probeTimedOut(e), windows, titles, sockets: new Set(), unproven: new Set() }
  }
  // the hot-tier pid verdict per windowed session (latch-consistent with hotSignature) + the legacy-scan gate.
  const legacy: { harness: string; hasPid: boolean }[] = []
  for (const [id, p] of parseLivePanes(out)) {
    windows.set(id, { panePid: p.panePid, pidAlive: agentAlive(id) })
    if (p.title) titles.set(id, p.title)
    if (windows.get(id)!.pidAlive === undefined) {
      // A corrupt row has no trustworthy harness to scan and renders liveness=unknown on its own. Letting this
      // optional legacy enrichment throw would turn one diagnosable row into a 409 for the entire board.
      try { const rec = readRecord(id); if (rec) legacy.push({ harness: rec.harness, hasPid: false }) }
      catch (e) { if (!(e instanceof SessionRecordUnusable)) throw e }
    }
  }
  // the whole-box ps table is gathered ONCE, and ONLY for the legacy pid-less-codex fallback (paneTreeRunsCodex).
  if (needsCodexProcScan(legacy)) {
    const procs = await procSnapshot().catch(() => undefined)   // codex-only, auxiliary; its failure isn't a liveness failure
    if (procs) for (const probe of windows.values()) probe.procs = procs
  }
  // LISTENER probe for every windowed session, once, in parallel (a live listener, not a lingering socket
  // file). A codex session has no rvSock → instant ENOENT → proven dead for the socket axis (codex ignores it).
  // The tri-state matters: 'unproven' (timeout/EAGAIN — a wedged or thrashed but possibly-alive listener) lands
  // in `unproven`, never silently not-live, so liveness() renders `unknown` not a false `offline` (issue #40).
  const ids = [...windows.keys()]
  // A burst of simultaneous Unix-socket connects can fill a Claude listener's accept backlog on macOS and
  // turn every healthy socket into `unproven`. Keep the probe bounded while preserving the tri-state result.
  const listening: Awaited<ReturnType<typeof rendezvousListening>>[] = []
  for (let start = 0; start < ids.length; start += 2) {
    listening.push(...await Promise.all(ids.slice(start, start + 2).map((id) => rendezvousListening(id))))
  }
  const sockets = new Set<string>()
  const unproven = new Set<string>()
  ids.forEach((id, i) => {
    if (listening[i] === 'live') sockets.add(id)
    else if (listening[i] === 'unproven') unproven.add(id)
  })
  return { probeFailed: false, windows, titles, sockets, unproven }
}
// Avoid process spawns on the hot path; old sessions without agent.pid remain warm-tier only.
let hotIds: string[] = []
let hotIdsAt = 0
export async function hotSignature(): Promise<string> {
  const now = Date.now()
  if (now - hotIdsAt >= 1000) { hotIds = listSessionIds(); hotIdsAt = now }
  const pairs: string[] = []
  const present: string[] = []
  for (const id of hotIds) {
    const alive = agentAlive(id)
    if (alive === undefined) continue   // no agent.pid → the warm tier's concern, not the hot death detector
    present.push(id)
    pairs.push(`${id}:${alive ? 1 : 0}`)
  }
  // prune latch entries for ids no longer registered (closed sessions), keeping the registry bounded.
  const live = new Set(hotIds)
  for (const k of [...pidRegistry.keys()]) if (!live.has(k)) pidRegistry.delete(k)
  return pairs.sort().join(',') + '|' + present.sort().join(',')
}

// Include listener and title changes so watchers refresh without another store read.
export async function warmSignature(): Promise<string> {
  const snap = await liveSnapshot()
  return (snap.probeFailed ? 'PROBEFAIL|' : '') + [...snap.windows.keys()].sort().join(',') + '#' +
    [...snap.sockets].sort().join(',') + '~' + [...snap.unproven].sort().join(',') + '|' +
    [...snap.titles].sort().map(([k, v]) => `${k}=${v}`).join(',')
}
// @@@ paneActivity - the harness-aware live self-summary: the SINGLE place a raw pane title becomes (or does
// NOT become) a session's headline activity. The board headline derives from the pane title ONLY for a
// harness whose pane title is its own task self-summary (`paneTitleIsSelfSummary`, an adapter capability —
// [[harness-adapter]]). claude qualifies (it writes its task summary into the OSC title), so we parse it with
// selfSummary (glyph-gated). codex does NOT — its pane title is a spinner glyph + the cwd FOLDER name, so
// returning it would headline the worktree folder, not the task; we refuse it (→ null) and sessionHeadline
// falls through to promptPreview (the launch prompt). The ONLY harness branch is the capability read here —
// no `if (codex)`, no glyph special-case; selfSummary stays the pure claude-title parser.
export function paneActivity(harness: Harness, paneTitle: string | null | undefined): string | null {
  if (paneTitle == null || !harness.paneTitleIsSelfSummary) return null
  return selfSummary(paneTitle)
}

// @@@ selfSummary - the agent's OWN live one-line description, parsed from its tmux pane title — the SINGLE
// place the "is this the agent speaking?" rule lives, exported so it is unit-auditable. Claude Code sets that
// title via an OSC escape and ALWAYS leads it with a status glyph: ✳ (and its ✶✻✽✢ blink frames) when idle, a
// braille spinner frame (U+2800–U+28FF) while working. That leading glyph is the only reliable proof the
// title is the agent and not tmux's default — which, from pane birth until the first turn, is the HOST NAME
// (e.g. `ser581555022561`) or a bare `Claude Code` splash. So the glyph is REQUIRED: no leading glyph → null,
// and the caller keeps showing the launch-prompt placeholder instead of flickering through the host name and
// splash. The leading glyph run (with the spaces/`·` between and after) is stripped — the dashboard draws its
// own status dot, a frozen spinner frame is just noise — leaving only the summary text (null if it is empty).
// ONE regex is the single source of the glyph rule: it gates (requires ≥1 glyph) and strips in one match.
// The glyph gate alone is not enough: Claude Code emits a glyph-led SPLASH of its own app name (`✳ Claude
// Code`) between pane birth and its first real task summary — it CLEARS the glyph gate yet is the app naming
// itself, not the task. GENERIC_SUMMARY rejects that stripped splash too, so the row keeps its launch-prompt
// placeholder instead of flashing "Claude Code" for a tick (the glyph-LESS `Claude Code` splash was already
// rejected by the gate; this catches its glyph-led twin).
const GENERIC_SUMMARY = /^claude code$/i
export function selfSummary(paneTitle: string): string | null {
  const m = /^[\s·]*(?:[✳✶✻✽✢⠀-⣿][\s·]*)+(.*)$/u.exec(paneTitle)
  if (!m) return null
  const text = m[1].trim()
  return text && !GENERIC_SUMMARY.test(text) ? text : null
}

// @@@ launchedAt - when we last started a tmux window for an id (set in launch()). claude needs ~15-20s
// after the window appears to recreate its rendezvous socket; in that window the socket is absent but the
// session is booting, NOT dead. reconcile consults this to report 'starting' (a distinct transient state)
// instead of 'offline' for BOOT_GRACE_MS after launch — so 'offline' only ever means genuinely dead. In-
// memory in the single server process (lost on restart, which is fine: a restart has nothing in flight).
const launchedAt = new Map<string, number>()
export const BOOT_GRACE_MS = 45000   // > SOCKET_READY_TIMEOUT_MS, and spans launchScript's bounded fast-fail retry
                              // window (~3 attempts) so a relaunching session reads 'starting', not 'offline'
export const LAUNCH_FAST_FAIL_S = 12 // launchScript retries the agent command when it exits faster than this: fast
                              // exit before readiness is retryable, but it is not proof of one specific cause

export function liveness(rec: SessRec, snap: LiveSnap): Liveness {
  if (!rec.session || rec.stopped || rec.archived) return 'offline'
  // Ask the resolved ADAPTER ([[harness-adapter]]): claude/pi/opencode prove their rendezvous listener;
  // codex proves its launch-registered pid (with the legacy descendant-tree fallback). The 'starting' grace
  // stays here: a just-launched agent whose online signal has not appeared yet reads 'starting', only past it
  // 'offline'.
  const h = harnessById(rec.harness || defaultHarness.id)
  const processAlive = sessionHost().kind === 'process-host' ? agentAlive(rec.session) === true : false
  const hostAlive = sessionHost().kind === 'process-host' ? processAlive : snap.windows.has(rec.session)
  const pane = sessionHost().kind === 'process-host' ? { pidAlive: processAlive } : snap.windows.get(rec.session)
  if (h.liveness(rec, hostAlive, runtimeRoot(), pane, snap.sockets.has(rec.session)) === 'online') return 'online'
  if (snap.probeFailed) return 'unknown'   // the probe failed — we can't tell, and MUST NOT guess offline
  // not provably online — but if this session's LISTENER probe couldn't conclude (timeout under load / EAGAIN
  // off a full-but-alive backlog), death is UNPROVEN: `unknown`, never a false `offline` a supervisor would
  // act on (issue #40 — a wedged-but-alive worker must not read as an actionable corpse).
  if (snap.unproven.has(rec.session)) return 'unknown'
  const at = launchedAt.get(rec.session)
  if (at && Date.now() - at < BOOT_GRACE_MS) return 'starting'
  // A dead TRANSPORT is not a dead AGENT. The socket path is keyed by session id alone, so a foreign teardown
  // (or a stray rm) can unlink it out from under its own live listener: the agent keeps working, unreachable,
  // and every path-connect ENOENTs — which the adapter axis above reports as proven death. The registered
  // agent.pid is a SECOND, independent witness, and while it still answers, death is UNPROVEN: `unknown`, not
  // the `offline` that disarms the relaunch guard and invites a human to kill a working agent. Same rule as
  // the probe-failure branch (issue #40), one layer down: only a corpse both witnesses agree on is actionable.
  if (agentAlive(rec.session) === true) return 'unknown'
  return 'offline'
}

// launch() and stop() in the session core own the boot window's start and end; the window itself is read
// only here, so they push the two edges in rather than sharing the map.
export const markLaunched = (id: string): void => { launchedAt.set(id, Date.now()) }
export const clearLaunched = (id: string): void => { launchedAt.delete(id) }

// clearing a session's leaf artifacts must also drop its latched death, or a relaunch under a recycled
// OS pid would read the old corpse's verdict.
export const forgetAgentPid = (id: string): void => { pidRegistry.delete(id) }
