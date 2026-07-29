import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { git, repoRoot, gitA, headSha, worktreeSpecSig, worktreeSpecDelta, type NodeOp } from './git.js'
import { guardWorktree } from './resilience.js'
import { HARNESSES, type HarnessId } from './harness.js'
import { encodeProject, projectRuntimeRoot, spexcodeHome } from './project-store.js'

export { encodeProject, spexcodeHome } from './project-store.js'

export type Config = {
  main?: string                    // path to the source-of-truth checkout (default: the `main` worktree)
  mainBranch?: string              // stable source-of-truth branch stamped by init (default: "main")
  branchPrefix?: string            // how a branch names its node (default: "node/")
  preset?: string                  // the SELECTED init preset — which cumulative .plugins tier `spex init` seeds (default 'default'; seed-time only, no launcher gate; read by init.ts; see [[init-preset]])
  // RETIRED ([[residence]]) — the old three-word footprint vote. Materialized artifacts carry no facts and are never
  // tracked now (one residence behavior: the per-clone exclude, plus the content filter for a mixed
  // contract file), so the field is IGNORED with a loud non-fatal notice (materialize's retiredAxisNotice);
  // it stays in the type only so the notice can read it. The schema deliberately has NO knob for the spec
  // DATA: `.spec` + spexcode.json are ALWAYS tracked ("git is the database") — the vocabulary itself makes
  // "untrack the spec" unsayable.
  render?: string
  // RETIRED (residence compat): the old private-overlay toggle — ignored with the same loud notice;
  // its data-untrack semantics are long gone. See `spex guide footprint` MIGRATIONS.
  private?: boolean
  // which harness targets `spex materialize` delivers into — a native HarnessId or a {plugin:"<folder>"}
  // bundle; resolved + validated by [[harness-select]] (harness-select.ts). REQUIRED — no default set; `spex init --harness` stamps it.
  harnesses?: (string | { plugin?: string })[]
  dashboard?: {
    apiUrl?: string                // the per-project backend the board proxies to (read frontend-side; see api-endpoint)
    title?: string                 // override for the browser-tab name (default: the repo-root basename; see tab-title)
    icon?: string                  // project identity icon: a picker preset id; existing emoji/Iconify/URL values remain supported ([[identity-config]])
    showHeadlessLaunchers?: boolean // include headless harness profiles in the dashboard New Session picker (default false; [[launcher-visibility]])
  }
  uploads?: {
    // One resumable attachment policy. Values default from templates/spexcode.json so a project may omit this
    // section, while spexcode.local.json can tune the whole top-level section for one machine.
    maxBytes?: number               // maximum bytes in one attachment (default: templates/spexcode.json)
    chunkBytes?: number             // raw PATCH payload cap and client slice size (default: templates/spexcode.json)
    concurrency?: number            // simultaneous attachment streams in one dashboard batch (default: templates/spexcode.json)
    requestTimeoutMs?: number       // browser timeout for one chunk/complete request (default: templates/spexcode.json)
    retryLimit?: number             // automatic retries after the first failed transient chunk request (default: templates/spexcode.json)
    retryDelayMs?: number           // wait between automatic transient-request retries (default: templates/spexcode.json)
    incompleteTtlMs?: number        // idle staging lifetime before an unfinished transfer expires (default: templates/spexcode.json)
    cleanupIntervalMs?: number      // reaper interval for stale staging bytes (default: templates/spexcode.json)
    minFreeBytes?: number           // filesystem capacity retained while reserving attachments (default: templates/spexcode.json)
    evidenceMaxBytes?: number       // retained ceiling for eval-evidence POST bodies (default: templates/spexcode.json)
  }
  sessions?: {
    maxActive?: number             // concurrency cap: max agents AUTONOMOUSLY PROGRESSING at once (default 8; see sessions.ts maxActive)
    // named launcher profiles: a session picks ONE by name at create time ([[launcher-select]]), fixing both
    // its harness AND its exact launch command; the chosen NAME is persisted on the record so resume reuses the
    // same auth. `harness` defaults to 'claude'. Host-specific `cmd`s (abs wrapper paths) belong in the
    // gitignored spexcode.local.json — the name is portable, the cmd is a machine fact.
    launchers?: { [name: string]: { harness?: HarnessId; cmd: string } }
    defaultLauncher?: string       // the launcher a create with no explicit --launcher/dropdown pick uses; required for no-choice creates
  }
  resources?: {
    sessionRssMiB?: number         // resident-memory budget for one session owner (default 1024)
    backendRssMiB?: number         // resident-memory budget for this project's backend instance (default 2048)
    idleCpuPercent?: number        // CPU budget for a non-progressing owner (default 2)
    sampleMs?: number              // CPU measurement window for an on-demand report (default 1000)
    reportIntervalMs?: number      // supervisor-owned snapshot cadence (default 60000)
  }
  serve?: {
    // public-exposure config for `spex serve --public` (resolved gateway-side; see [[public-mode]] / gateway.ts).
    // The password is NEVER read from here — flag/env only — so this file stays committable.
    public?: {
      enabled?: boolean              // turn public mode on without the --public flag
      http?: boolean                 // drop TLS (the --http escape hatch) — password then travels in cleartext
      tls?: { cert?: string; key?: string }   // PATHS to your own cert/key; omit for a cached self-signed default
    }
  }
  issues?: {
    enabled?: boolean                // the [[local-issues]] issues-workflow on/off switch (default ON). OFF silences the post-merge nudge + hides the dashboard view; flip by editing this key (no CLI toggle verb — v0.3.0). A legacy `proposals.enabled` is NOT read; `spex doctor` reports it.
  }
  forge?: {
    host?: string                    // explicit forge host id ('github'|'gitlab'|…) overriding the origin-remote derivation ([[forge-host]] — read by spec-forge drivers.ts resolveForgeHost, not here). A project fact → committed spexcode.json.
  }
}
// the resolved LAYOUT convention — main/mainBranch/branchPrefix filled to defaults. `dashboard`, `sessions`,
// `serve`, `harnesses`, `render`, and `preset` are frontend/runtime/policy concerns (read separately via readConfig —
// preset by init.ts at seed time, harnesses by [[harness-select]]; see api-endpoint / sessions.ts maxActive /
// gateway.ts), NOT layout fields, so they stay out of the convention rather than forcing a default.
type Convention = Required<Omit<Config, 'dashboard' | 'uploads' | 'sessions' | 'resources' | 'serve' | 'harnesses' | 'preset' | 'issues' | 'forge' | 'private' | 'render'>>

export type Worktree = {
  path: string; branch: string | null; node: string | null
  session: string | null; status: string | null; isMain: boolean
  liveness?: 'offline' | 'unknown'
  ops: NodeOp[]   // pending spec-node changes this worktree makes vs main (the board's overlay)
}
export type Layout = { main: string; convention: Convention; worktrees: Worktree[] }

// Read an OPTIONAL JSON config file. An ABSENT file is the legitimate default (return {}); a
// PRESENT-but-malformed one is a user error we must NOT swallow — a typo would otherwise silently
// drop every tuned setting the file holds (lint budgets, launchers, layout) and revert to defaults
// with no diagnostic. Fail LOUD, naming the file and the parse error, so the author sees what broke.
export function readJsonConfig(p: string): any {
  if (!existsSync(p)) return {}
  try { return JSON.parse(readFileSync(p, 'utf8')) }
  catch (e) {
    const err = new Error(`malformed ${p}: ${(e as Error).message}\n  → its settings were NOT applied. Fix the JSON syntax (an absent file is a fine default; a broken one is not).`)
    err.name = 'ConfigError'   // rendered message-only at the CLI boundary (like BackendError), not as a stack dump
    throw err
  }
}
// committed `spexcode.json` with an OPTIONAL machine-local `spexcode.local.json` layered on top (gitignored).
// The local layer is the durable home for HOST-SPECIFIC values that must never be committed — e.g. an
// absolute worker-launcher path (the host-path leak the repo otherwise warns against). Precedence per field:
// local over committed; a targeted env override (e.g. SPEXCODE_CODEX_SERVER_CMD) still wins at its read site.
export function readConfig(root: string): Config {
  const committed = readJsonConfig(join(root, 'spexcode.json'))
  const local = readJsonConfig(join(root, 'spexcode.local.json'))
  const out: any = { ...committed }
  for (const k of Object.keys(local)) {
    const b = committed[k], o = local[k]
    out[k] = (b && o && typeof b === 'object' && typeof o === 'object' && !Array.isArray(o)) ? { ...b, ...o } : o
  }
  return out
}

export type UploadPolicy = Required<NonNullable<Config['uploads']>>

const TEMPLATE_CONFIG = fileURLToPath(new URL('../templates/spexcode.json', import.meta.url))
const MIN_POSITIVE_INTEGER = 1
const MIN_NONNEGATIVE_INTEGER = 0

function uploadConfigError(field: keyof UploadPolicy, rule: string): never {
  const error = new Error(`uploads.${field} must be ${rule}`)
  error.name = 'ConfigError'
  throw error
}

function configuredInteger(value: unknown, field: keyof UploadPolicy, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    uploadConfigError(field, minimum === MIN_POSITIVE_INTEGER ? 'a positive integer' : 'a non-negative integer')
  }
  return value
}

function resolveUploadPolicy(values: Record<keyof UploadPolicy, unknown>): UploadPolicy {
  const policy: UploadPolicy = {
    maxBytes: configuredInteger(values.maxBytes, 'maxBytes', MIN_POSITIVE_INTEGER),
    chunkBytes: configuredInteger(values.chunkBytes, 'chunkBytes', MIN_POSITIVE_INTEGER),
    concurrency: configuredInteger(values.concurrency, 'concurrency', MIN_POSITIVE_INTEGER),
    requestTimeoutMs: configuredInteger(values.requestTimeoutMs, 'requestTimeoutMs', MIN_POSITIVE_INTEGER),
    retryLimit: configuredInteger(values.retryLimit, 'retryLimit', MIN_NONNEGATIVE_INTEGER),
    retryDelayMs: configuredInteger(values.retryDelayMs, 'retryDelayMs', MIN_NONNEGATIVE_INTEGER),
    incompleteTtlMs: configuredInteger(values.incompleteTtlMs, 'incompleteTtlMs', MIN_POSITIVE_INTEGER),
    cleanupIntervalMs: configuredInteger(values.cleanupIntervalMs, 'cleanupIntervalMs', MIN_POSITIVE_INTEGER),
    minFreeBytes: configuredInteger(values.minFreeBytes, 'minFreeBytes', MIN_NONNEGATIVE_INTEGER),
    evidenceMaxBytes: configuredInteger(values.evidenceMaxBytes, 'evidenceMaxBytes', MIN_POSITIVE_INTEGER),
  }
  if (policy.chunkBytes > policy.maxBytes) uploadConfigError('chunkBytes', 'no greater than uploads.maxBytes')
  return policy
}

export function uploadPolicyDefaults(): UploadPolicy {
  return resolveUploadPolicy(readJsonConfig(TEMPLATE_CONFIG).uploads as Record<keyof UploadPolicy, unknown>)
}

// The seed template is the sole default-value source. Existing projects may omit `uploads`; they receive this
// policy, while a committed/local value overrides it through readConfig's existing one-level merge.
export function readUploadPolicy(root: string): UploadPolicy {
  const configured = readConfig(root).uploads
  return resolveUploadPolicy({ ...uploadPolicyDefaults(), ...configured } as Record<keyof UploadPolicy, unknown>)
}

// the shared git common dir (env-stripped git() so a hook's exported GIT_DIR can't misdirect it). Memoized:
// it's a process constant, but mainBranch()/mainRoot() resolve it per call (~60 git rev-parse forks per board build without the cache).
let commonDirCache: string | null = null
export function gitCommonDir(): string {
  if (commonDirCache === null) commonDirCache = git(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()
  return commonDirCache
}

export function mainBranch(): string {
  let checkout: string
  try { checkout = mainCheckout() } catch { return 'main' }
  return readConfig(checkout).mainBranch?.trim() || 'main'
}

// the MAIN checkout (the root working tree) for a project — the SAME answer from main OR any linked worktree
// (dirname of the shared git common dir). Codex reads a LINKED worktree's PROJECT hooks from the root checkout's
// `.codex` (codex-rs hooks_config_folder override), NOT the worktree's, so the codex hooks shim + trust
// materialize here while AGENTS.md/skills stay per-worktree — see [[harness-adapter]] (harness.ts).
export function mainCheckout(proj?: string): string {
  const gcd = proj
    ? git(['-C', proj, 'rev-parse', '--path-format=absolute', '--git-common-dir']).trim()
    : gitCommonDir()
  return dirname(gcd)
}

// @@@ global per-session store - Fork A: NO SpexCode files live in the worktree any more, so the worktree's
// spec/code tree is pristine (zero per-session pollution). Every per-session runtime artifact — the
// structured record (session.json) AND the launcher products (prompt, launch, launch.sh) AND the recorded comms AND
// the spec-discipline sentinels — lives in a per-USER GLOBAL store, keyed by the harness `session_id` so two
// agents in one folder never clobber, and grouped PER PROJECT (mirroring Claude's ~/.claude/projects/<enc>/)
// so the board enumerates ONE directory. This is the single seam that knows where the store sits; sessions.ts
// and the shell hooks resolve through the SAME scheme (the hooks reimplement it in bash, so any change here
// must be mirrored in .plugins/core/*/). SPEXCODE_HOME overrides the root for test isolation.
// encode a project-root path into ONE safe directory segment (Claude's scheme: path separators → '-'). The
// SAME transform runs in TS and in the shell hooks, so a board read and a hook write land on the SAME dir.
// this project's per-PROJECT runtime tier — the sessions/ records AND the per-TREE materialize slots (below) —
// living under the SAME global per-project dir, so NOTHING SpexCode materializes stays in the worktree (the
// worktree holds only the harness-discovered CLAUDE.md/AGENTS.md + shims, which must sit in-tree).
// proj-aware for `spex init <dir>` / materialize(proj); cwd-based default for the hooks/board. The shell
// hooks mirror this as hp_runtime_dir.
export function runtimeRoot(proj?: string): string {
  const gcd = proj
    ? git(['-C', proj, 'rev-parse', '--path-format=absolute', '--git-common-dir']).trim()
    : gitCommonDir()
  return projectRuntimeRoot(gcd)
}
// the per-WORKTREE materialize slot — <runtime>/trees/<enc(worktree-toplevel)> — holding the materialize
// products that are a pure function of ONE tree's .plugins (hooks-manifest, content-hash, plugin-folders).
// Slotted per tree exactly like sessions/<id> is slotted per session: the old single global file made the
// last-materialized tree win, so dispatch ran tree A's compiled hook set inside tree B's sessions
// ([[hook-dispatch]]). Key = the sessions encodeProject transform over `rev-parse --show-toplevel`, the
// SAME derivation dispatch.sh's shell mirror (hp_tree_dir) runs from its own cwd — so writer and reader
// land on the same slot from the same tree, and only from the same tree. Throws when `wt` is not a live
// git tree (fail loud); a best-effort caller (the close-time GC) wraps it.
export function treeSlotDir(wt: string): string {
  const top = git(['-C', wt, 'rev-parse', '--show-toplevel']).trim()
  return join(runtimeRoot(wt), 'trees', encodeProject(top || wt))
}
// this project's per-session records dir, one session's dir, its structured record, and a sibling artifact —
// all keyed by session_id under <home>/projects/<enc>/sessions/.
export function sessionsRoot(): string { return join(runtimeRoot(), 'sessions') }
export function sessionStoreDir(id: string): string { return join(sessionsRoot(), id) }
export function sessionRecordPath(id: string): string { return join(sessionStoreDir(id), 'session.json') }
export function sessionArtifactPath(id: string, name: string): string { return join(sessionStoreDir(id), name) }

// the structured per-session record, as it sits on disk. Written one-field-per-line with EVERY key present
// (see sessions.ts writeRecord) so the hot-path mark-active shell hook can value-replace status/proposal/note
// with sed and never needs jq. Read here for the overlay; sessions.ts owns the full typed read/write.
export type RawRecord = {
  session_id: string; governed: boolean; worktree_path: string; branch: string | null
  node: string | null; title: string | null; name: string | null; parent?: string | null
  status: string; proposal: string | null; merges: number; note: string | null
  sortkey: number | null; createdAt: number; harness?: string; harness_session_id?: string
  stopped?: boolean
  archived?: boolean  // the human ARCHIVED this session ([[archive]]) — only a proven cold/offline row; absent → false on old records
  cold_proof?: string  // durable exact leaf + adapter cold proof; absent on legacy archives, which remain visible hazards
  adapter_recovery?: string // explicit lifecycle recovery required after a partial adapter mutation; absent on old records
  launcher?: string   // the launcher profile this session was created under ([[launcher-select]]); absent/empty only on old records predating launchers
  launch_cmd?: string // the RESOLVED base launcher command PINNED at creation, so a resume replays the EXACT launcher (and its config-dir env) that made the conversation, never a since-changed default ([[launcher-select]] resume-launcher-pin); absent → old record, fall back to the launcher name / ambient
  create_request_id?: string // SHA-256 digest of the create Idempotency-Key; the raw key is never persisted
  create_payload_hash?: string // normalized create payload bound to create_request_id
  launch_readiness_pending?: '' | RawLaunchReadinessPending
}

export const SESSION_LIFECYCLES = ['active', 'idle', 'awaiting', 'parked', 'error', 'asking', 'queued'] as const
export const SESSION_PROPOSALS = ['merge', 'nothing', 'close'] as const
export type SessionLifecycle = typeof SESSION_LIFECYCLES[number]
export type SessionProposal = typeof SESSION_PROPOSALS[number]
const sessionLifecycles = new Set<string>(SESSION_LIFECYCLES)
const sessionProposals = new Set<string>(SESSION_PROPOSALS)
export const isSessionLifecycle = (value: unknown): value is SessionLifecycle =>
  typeof value === 'string' && sessionLifecycles.has(value)
export const isSessionProposal = (value: unknown): value is SessionProposal =>
  typeof value === 'string' && sessionProposals.has(value)

export type RawLaunchReadinessOriginal = {
  status: string
  proposal: string | null
  note: string | null
  stopped: boolean
  archived: boolean
  cold_proof: string | null
  adapter_recovery: string | null
}

export type RawLaunchReadinessPending = {
  version: 1
  startedAt: number
  original: RawLaunchReadinessOriginal
}

// A launch candidate is durable before it is public. Readers of the authored lifecycle use this one parser
// so the board and the independent timeline observer cannot disagree about an in-flight resume. Invalid
// pending bytes throw: a damaged publication fence is unknowable state, never permission to project online.
export function rawLaunchReadinessOriginal(raw: RawRecord): RawLaunchReadinessOriginal | null {
  const pending = raw.launch_readiness_pending
  if (pending == null || pending === '') return null
  const original = pending && typeof pending === 'object' ? pending.original : null
  if (pending.version !== 1 || !Number.isFinite(pending.startedAt) || !original || typeof original !== 'object'
    || !isSessionLifecycle(original.status)
    || !(original.proposal === null || original.proposal === '' || isSessionProposal(original.proposal))
    || !(typeof original.note === 'string' || original.note === null)
    || typeof original.stopped !== 'boolean' || typeof original.archived !== 'boolean'
    || !(typeof original.cold_proof === 'string' || original.cold_proof === null)
    || !(typeof original.adapter_recovery === 'string' || original.adapter_recovery === null)) {
    throw new Error(`session '${raw.session_id}' has an invalid launch_readiness_pending fence`)
  }
  return original
}

// the agent's OWN session id from the environment — the only locator now that the record left the worktree.
// Three tiers, in order:
//   (1) a harness's per-thread env var (`sessionEnvVar`) RESOLVED VIA THE ALIAS — when it lands on a governed
//       record (directly, or through that record's `harness_session_id`), that record's SpexCode id is the
//       answer. This MUST win: codex's design-C runs ONE shared per-project app-server whose env carries the
//       FIRST launched session's `SPEXCODE_SESSION_ID`, and the agent's shell tool (its `spex session
//       done/park/ask`) runs INSIDE that app-server process, so `SPEXCODE_SESSION_ID` is contaminated with the
//       wrong session. But codex injects the ACTING thread's id into every spawned command's env as
//       CODEX_THREAD_ID (== codex's `sessionEnvVar`), so the per-thread var aliases to the RIGHT record while
//       the shared `SPEXCODE_SESSION_ID` does not.
//   (2) else `SPEXCODE_SESSION_ID` (the GOVERNED record id the launcher bakes in) — the claude path and the
//       non-shared baseline.
//   (3) else a harness's env var RAW — a self-launched, non-governed agent's own minted id, which has no
//       governed record to alias to (codex CODEX_THREAD_ID / claude CLAUDE_CODE_SESSION_ID). The RAW form must
//       stay BELOW (2): an un-aliased codex thread id is not a record key, so it must never beat a real
//       `SPEXCODE_SESSION_ID`.
// Claude is UNCHANGED: its `sessionEnvVar` (CLAUDE_CODE_SESSION_ID) already EQUALS its record id, so tier (1)
// resolves to that very id — the same value `SPEXCODE_SESSION_ID` would have returned; there is no shared
// app-server to contaminate it. No worktree fallback. (sessions.ts's `ownSessionId` delegates here; spec-eval
// reads it to resolve the current node.)
export function envSessionId(): string | null {
  for (const h of HARNESSES) {
    const v = process.env[h.sessionEnvVar]
    if (v && v.trim()) { const r = readAliasedRawRecord(v.trim()); if (r) return r.session_id }
  }
  const o = process.env.SPEXCODE_SESSION_ID
  if (o && o.trim()) return o.trim()
  for (const h of HARNESSES) { const v = process.env[h.sessionEnvVar]; if (v && v.trim()) return v.trim() }
  return null
}
// @@@ RecordEntry - a record read has THREE outcomes, and collapsing them is what let a live session read as
// "no session record". ABSENT (no file) is the legitimate nothing — a self-launched agent that only ever wrote
// spec-discipline sentinels has a store dir and no record. CORRUPT (present but unparseable, or parseable but
// not a record) is a FACT about a session that exists, so it must reach the surfaces as itself instead of
// masquerading as absence: sessions-core refuses every writer on it and the board gives it its own row. Any
// OTHER read failure (permissions, I/O) still THROWS — a transient fault must not read as either.
export type RecordEntry =
  | { kind: 'ok'; raw: RawRecord }
  | { kind: 'absent' }
  | { kind: 'corrupt'; path: string; error: string }

export type PublicRecordEntry =
  | { kind: 'ok'; raw: RawRecord; liveness: 'offline' | null }
  | { kind: 'absent' }
  | { kind: 'corrupt'; sessionId: string; governed: boolean | null; path: string; error: string; liveness: 'unknown' }

export function readRecordEntry(id: string): RecordEntry {
  const path = sessionRecordPath(id)
  let text: string
  try { text = readFileSync(path, 'utf8') }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' }; throw e }
  let raw: unknown
  try { raw = JSON.parse(text) }
  catch (e) { return { kind: 'corrupt', path, error: e instanceof Error ? e.message : String(e) } }
  if (!raw || typeof raw !== 'object' || !(raw as RawRecord).session_id)
    return { kind: 'corrupt', path, error: 'parsed, but carries no session_id — not a session record' }
  return { kind: 'ok', raw: raw as RawRecord }
}

// The ONE public session-record parser. Internal mutation/readiness code uses readRecordEntry's exact raw
// candidate; every public projection passes through here. A valid pending fence replaces all lifecycle-facing
// fields with its frozen original and forces offline liveness. Malformed pending bytes remain a present,
// corrupt/unknown row instead of leaking candidate state or disappearing as absence.
export function projectPublicRecordEntry(id: string, entry: RecordEntry): PublicRecordEntry {
  if (entry.kind === 'absent') return entry
  if (entry.kind === 'corrupt') return {
    kind: 'corrupt', sessionId: id, governed: null, path: entry.path, error: entry.error, liveness: 'unknown',
  }
  try {
    const original = rawLaunchReadinessOriginal(entry.raw)
    if (!original) return { kind: 'ok', raw: entry.raw, liveness: null }
    return {
      kind: 'ok',
      raw: {
        ...entry.raw,
        status: original.status,
        proposal: original.proposal || null,
        note: original.note || null,
        stopped: original.stopped,
        archived: original.archived,
        cold_proof: original.cold_proof ?? undefined,
        adapter_recovery: original.adapter_recovery ?? undefined,
        launch_readiness_pending: '',
      },
      liveness: 'offline',
    }
  } catch (error) {
    return {
      kind: 'corrupt',
      sessionId: id,
      governed: typeof entry.raw.governed === 'boolean' ? entry.raw.governed : null,
      path: sessionRecordPath(id),
      error: error instanceof Error ? error.message : String(error),
      liveness: 'unknown',
    }
  }
}

export function readPublicRecordEntry(id: string): PublicRecordEntry {
  return projectPublicRecordEntry(id, readRecordEntry(id))
}
export function readRawRecord(id: string): RawRecord | null {
  try { const e = readRecordEntry(id); return e.kind === 'ok' ? e.raw : null }
  catch { return null }
}
// resolve a possibly-ALIASED session id to its raw record. A codex hook or spawned command can carry the codex
// THREAD id — payload session_id / CODEX_THREAD_ID — not the SpexCode record id the store is keyed by. Direct id
// wins; else the one record that captured this id as `harness_session_id` (the backend stored it at thread/start,
// before any tool turn).
// Null when neither resolves. Mirrors the shell `hp_store_dir` alias grep — one resolution rule, both layers.
export function readAliasedRawRecord(id: string): RawRecord | null {
  const e = readAliasedRecordEntry(id)
  return e.kind === 'ok' ? e.raw : null
}
// the same alias resolution, keeping the three-way outcome. A CORRUPT record at the direct id settles the
// question — we found this session and cannot read it; walking on to the alias would report a corrupt record
// as absent, the exact collapse this type exists to prevent.
export function readAliasedRecordEntry(id: string): RecordEntry {
  const direct = readRecordEntry(id)
  if (direct.kind !== 'absent') return direct
  for (const sid of listSessionIds()) {
    const r = readRawRecord(sid)
    if (r && r.harness_session_id && r.harness_session_id === id) return { kind: 'ok', raw: r }
  }
  return { kind: 'absent' }
}
// every session_id this project has a record for (the board's enumeration source — replaces `git worktree
// list`). A MISSING store dir means no session ever launched → []. But any OTHER readdir failure THROWS
// (preserving the fail-loud-enumeration invariant `git worktree list` had): a transient FS error must never
// read as "every session vanished" — the watch poll skips the tick on a throw, never emitting a false mass-close.
export function listSessionIds(): string[] {
  let ents
  try { ents = readdirSync(sessionsRoot(), { withFileTypes: true }) }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e }
  return ents.filter((d) => d.isDirectory()).map((d) => d.name)
}

// memo the overlay (4 git diffs/worktree, all .spec-scoped) keyed on fork-point merge-base + HEAD + spec
// sig + MAIN'S TIP ([[worktree-linker]]): the main-tip component is what lets a merge landing identical
// content dissolve a worktree's now-moot ops — the recompute it triggers is cheap because every diff is
// .spec-scoped.
const deltaCache = new Map<string, { key: string; ops: NodeOp[] }>()
const safeHead = (p: string): string => { try { return headSha(p) } catch { return '' } }
const safeMergeBase = async (wtPath: string, mainRef: string): Promise<string> => {
  try { return (await gitA(['-C', wtPath, 'merge-base', mainRef, 'HEAD'])).trim() } catch { return '' }
}
let layoutHeadWarned = false
async function cachedDelta(wtPath: string, mainRef: string, mainSha: string): Promise<NodeOp[]> {
  const wtHead = safeHead(wtPath)
  const base = await safeMergeBase(wtPath, mainRef)
  // fail loud, never stale: if the merge-base, HEAD, or main tip can't be read the key is untrustworthy —
  // bypass the cache and recompute (warn once) rather than risk serving a delta keyed on an empty sha
  // across a real change.
  if (!base || !wtHead || !mainSha) {
    if (!layoutHeadWarned) { layoutHeadWarned = true; console.warn('spec-cli: layout overlay cache bypassed (unreadable merge-base/HEAD/main tip), recomputing every read') }
    return worktreeSpecDelta(wtPath, mainRef)
  }
  const key = `${base}\0${wtHead}\0${mainSha}\0${worktreeSpecSig(wtPath)}`
  const hit = deltaCache.get(wtPath)
  if (hit && hit.key === key) return hit.ops
  const ops = await worktreeSpecDelta(wtPath, mainRef, base)
  deltaCache.set(wtPath, { key, ops })
  return ops
}

export async function resolveLayout(): Promise<Layout> {
  const root = repoRoot()
  const main = dirname(gitCommonDir())   // the main checkout — same answer from main OR any linked worktree
  const cfg = readConfig(main)
  const base = mainBranch()
  const convention: Convention = {
    main: cfg.main || '',
    mainBranch: base,
    branchPrefix: cfg.branchPrefix ?? 'node/',
  }
  const mainRef = base
  // the board enumerates the GLOBAL per-session store (NOT `git worktree list`): every GOVERNED record this
  // project owns, each carrying the worktree_path its spec-delta is computed from. Non-governed (user-self-
  // launched) records are excluded — board state is a managed-session concern ([[state]]). Each delta is
  // independent → compute (or cache-hit) in parallel, keyed by worktree path as before. guardWorktree wraps
  // each: a worktree whose dir was genuinely removed mid-read (a worker self-merged + retired it) is OMITTED;
  // one that still exists but hit a transient detail failure is kept as a DEGRADED row from the last cached delta.
  const publicEntries = listSessionIds().map((id) => readPublicRecordEntry(id))
    .filter((entry) => entry.kind === 'corrupt' ? entry.governed !== false : entry.kind === 'ok' && entry.raw.governed)
  const records = publicEntries.flatMap((entry) => entry.kind === 'ok' ? [entry] : [])
  // main's tip, resolved ONCE per board read — a component of every worktree's overlay cache key
  // ([[worktree-linker]]: landed content must dissolve the ops it made moot).
  const mainSha = await (async () => {
    try { return (await gitA(['-C', main, 'rev-parse', '--verify', `${mainRef}^{commit}`])).trim() } catch { return '' }
  })()
  const rows = await Promise.all(records.map(({ raw: r, liveness }) => {
    const node = r.node ?? (r.branch && r.branch.startsWith(convention.branchPrefix) ? r.branch.slice(convention.branchPrefix.length) : null)
    const base: Worktree = { path: r.worktree_path, branch: r.branch, node, session: r.session_id, status: r.status, isMain: false, ...(liveness ? { liveness } : {}), ops: [] }
    // @@@ archived rows cost nothing - a shelved session ([[archive]]) keeps its row (the record is the
    // existence truth) but skips the per-worktree spec-delta entirely: that git-history probe is the board's
    // dominant per-row cost, and shelving is exactly the human saying "stop spending attention here". So the
    // price of a retained archive is one enumerated record, NOT a git walk per poll.
    if (r.archived) return Promise.resolve(base)
    return guardWorktree<Worktree>(r.worktree_path,
      async (): Promise<Worktree> => ({ ...base, ops: await cachedDelta(r.worktree_path, mainRef, mainSha) }),
      (): Worktree => ({ ...base, ops: deltaCache.get(r.worktree_path)?.ops ?? [] }))
  }))
  const corruptRows: Worktree[] = publicEntries.flatMap((entry) => entry.kind === 'corrupt'
    ? [{ path: '', branch: null, node: null, session: entry.sessionId, status: 'corrupt', liveness: 'unknown', isMain: false, ops: [] }]
    : [])
  const sessionWorktrees = [...rows.filter((w): w is Worktree => w !== null), ...corruptRows]
  // the main checkout row (isMain) — always present, carries no overlay; it anchors the merged tree the board draws.
  const mainRow: Worktree = { path: main, branch: base, node: null, session: null, status: null, isMain: true, ops: [] }
  const worktrees = [mainRow, ...sessionWorktrees]
  // drop cache entries for worktrees that may no longer hold one — closed sessions (gone from the store) AND
  // newly-archived ones (which no longer compute a delta), so archiving SELF-EVICTS its cached ops instead of
  // stranding them in a map nothing prunes.
  const live = new Set(records.filter(({ raw }) => !raw.archived).map(({ raw }) => raw.worktree_path))
  for (const k of [...deltaCache.keys()]) if (!live.has(k)) deltaCache.delete(k)
  return { main: convention.main || main || root, convention, worktrees }
}
