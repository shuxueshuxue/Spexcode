import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { git, repoRoot, gitA, headSha, worktreeSpecSig, worktreeSpecDelta, type NodeOp } from './git.js'
import { guardWorktree } from './resilience.js'
import { HARNESSES } from './harness.js'

type Config = {
  main?: string                    // path to the source-of-truth checkout (default: the `main` worktree)
  mainBranch?: string              // source-of-truth BRANCH worktrees fork from (default: auto-detected — see mainBranch())
  branchPrefix?: string            // how a branch names its node (default: "node/")
  preset?: string                  // the SELECTED init preset — which cumulative .config tier `spex init` seeds (default 'default'; seed-time only, no launcher gate; read by init.ts; see [[init-preset]])
  // RETIRED ([[render-policy]]) — the old three-word footprint vote. Renders carry no facts and are never
  // tracked now (one residence behavior: the per-clone exclude, plus the content filter for a mixed
  // contract file), so the field is IGNORED with a loud non-fatal notice (materialize's retiredAxisNotice);
  // it stays in the type only so the notice can read it. The schema deliberately has NO knob for the spec
  // DATA: `.spec` + spexcode.json are ALWAYS tracked ("git is the database") — the vocabulary itself makes
  // "untrack the spec" unsayable.
  render?: string
  // RETIRED (render-policy compat): the old private-overlay toggle — ignored with the same loud notice;
  // its data-untrack semantics are long gone. See `spex guide footprint` MIGRATIONS.
  private?: boolean
  // which harness targets `spex materialize` delivers into — native ids ('claude'|'codex') or a {plugin:"<folder>"}
  // bundle; resolved + validated by [[harness-select]] (harness-select.ts). Default (omitted): all native harnesses.
  harnesses?: (string | { plugin?: string })[]
  dashboard?: {
    apiUrl?: string                // the per-project backend the board proxies to (read frontend-side; see api-endpoint)
    title?: string                 // override for the browser-tab name (default: the repo-root basename; see tab-title)
    icon?: string                  // the browser-tab favicon: an emoji ("🔭") or an Iconify name ("mdi:rocket-launch"); see tab-icon
  }
  sessions?: {
    maxActive?: number             // concurrency cap: max agents AUTONOMOUSLY PROGRESSING at once (default 8; see sessions.ts maxActive)
    // named launcher profiles: a session picks ONE by name at create time ([[launcher-select]]), fixing both
    // its harness AND its exact launch command; the chosen NAME is persisted on the record so resume reuses the
    // same auth. `harness` defaults to 'claude'. Host-specific `cmd`s (abs wrapper paths) belong in the
    // gitignored spexcode.local.json — the name is portable, the cmd is a machine fact.
    launchers?: { [name: string]: { harness?: 'claude' | 'codex'; cmd: string } }
    defaultLauncher?: string       // the launcher a create with no explicit --launcher/dropdown pick uses; required for no-choice creates
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
    enabled?: boolean                // the [[local-issues]] issues-workflow on/off switch (default ON). OFF silences the post-merge nudge + hides the dashboard view; flip with `spex issues on|off`. (Pre-rename `proposals.enabled` still reads — localIssues.ts issuesEnabled.)
  }
  forge?: {
    host?: string                    // explicit forge host id ('github'|'gitlab'|…) overriding the origin-remote derivation ([[forge-host]] — read by spec-forge drivers.ts resolveForgeHost, not here). A project fact → committed spexcode.json.
  }
}
// the resolved LAYOUT convention — main/mainBranch/branchPrefix filled to defaults. `dashboard`, `sessions`,
// `serve`, `harnesses`, `render`, and `preset` are frontend/runtime/policy concerns (read separately via readConfig —
// preset by init.ts at seed time, harnesses by [[harness-select]]; see api-endpoint / sessions.ts maxActive /
// gateway.ts), NOT layout fields, so they stay out of the convention rather than forcing a default.
type Convention = Required<Omit<Config, 'dashboard' | 'sessions' | 'serve' | 'harnesses' | 'preset' | 'issues' | 'forge' | 'private' | 'render'>>

export type Worktree = {
  path: string; branch: string | null; node: string | null
  session: string | null; status: string | null; isMain: boolean
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

// the shared git common dir (env-stripped git() so a hook's exported GIT_DIR can't misdirect it). Memoized:
// it's a process constant, but mainBranch()/mainRoot() resolve it per call (~60 git rev-parse forks per board build without the cache).
let commonDirCache: string | null = null
export function gitCommonDir(): string {
  if (commonDirCache === null) commonDirCache = git(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()
  return commonDirCache
}

export function mainBranch(): string {
  try {
    const override = readConfig(mainCheckout()).mainBranch?.trim()
    if (override) return override
    const cur = git(['-C', mainCheckout(), 'symbolic-ref', '--short', 'HEAD']).trim()
    if (cur) return cur
  } catch { /* fall through to the conventional default */ }
  return 'main'
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
// must be mirrored in .config/core/*/). SPEXCODE_HOME overrides the root for test isolation.
export function spexcodeHome(): string {
  return process.env.SPEXCODE_HOME || join(homedir(), '.spexcode')
}
// encode a project-root path into ONE safe directory segment (Claude's scheme: path separators → '-'). The
// SAME transform runs in TS and in the shell hooks, so a board read and a hook write land on the SAME dir.
export function encodeProject(root: string): string {
  return root.replace(/[/.]/g, '-')
}
// this project's per-PROJECT runtime tier — the materialized hook manifest + content-hash marker —
// living alongside sessions/ under the SAME global per-project dir, so NOTHING SpexCode renders
// stays in the worktree (not even the manifest; the worktree holds only the harness-discovered CLAUDE.md/
// AGENTS.md + shims, which must sit in-tree). proj-aware for `spex init <dir>` / materialize(proj); cwd-based
// default for the hooks/board. The shell hooks mirror this as hp_runtime_dir.
export function runtimeRoot(proj?: string): string {
  const gcd = proj
    ? git(['-C', proj, 'rev-parse', '--path-format=absolute', '--git-common-dir']).trim()
    : gitCommonDir()
  return join(spexcodeHome(), 'projects', encodeProject(dirname(gcd)))
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
  launcher?: string   // the launcher profile this session was created under ([[launcher-select]]); absent/empty only on old records predating launchers
  launch_cmd?: string // the RESOLVED base launcher command PINNED at creation, so a resume replays the EXACT launcher (and its config-dir env) that made the conversation, never a since-changed default ([[launcher-select]] resume-launcher-pin); absent → old record, fall back to the launcher name / ambient
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
// app-server to contaminate it. No worktree fallback. (sessions.ts's `ownSessionId` delegates here; spec-yatsu
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
export function readRawRecord(id: string): RawRecord | null {
  try {
    const raw = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
    return raw && typeof raw === 'object' && raw.session_id ? raw as RawRecord : null
  } catch { return null }
}
// resolve a possibly-ALIASED session id to its raw record. A codex hook or spawned command can carry the codex
// THREAD id — payload session_id / CODEX_THREAD_ID — not the SpexCode record id the store is keyed by. Direct id
// wins; else the one record that captured this id as `harness_session_id` (the backend stored it at thread/start,
// before any tool turn).
// Null when neither resolves. Mirrors the shell `hp_store_dir` alias grep — one resolution rule, both layers.
export function readAliasedRawRecord(id: string): RawRecord | null {
  const direct = readRawRecord(id)
  if (direct) return direct
  for (const sid of listSessionIds()) {
    const r = readRawRecord(sid)
    if (r && r.harness_session_id && r.harness_session_id === id) return r
  }
  return null
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

// memo the overlay (3 git diffs/worktree) keyed on fork-point merge-base + HEAD + spec sig — keying on the
// merge-base NOT main's HEAD means unrelated merges that don't move the fork point stay cache hits.
const deltaCache = new Map<string, { key: string; ops: NodeOp[] }>()
const safeHead = (p: string): string => { try { return headSha(p) } catch { return '' } }
const safeMergeBase = async (wtPath: string, mainRef: string): Promise<string> => {
  try { return (await gitA(['-C', wtPath, 'merge-base', mainRef, 'HEAD'])).trim() } catch { return '' }
}
let layoutHeadWarned = false
async function cachedDelta(wtPath: string, mainRef: string): Promise<NodeOp[]> {
  const wtHead = safeHead(wtPath)
  const base = await safeMergeBase(wtPath, mainRef)
  // fail loud, never stale: if the merge-base or HEAD can't be read the key is untrustworthy — bypass the
  // cache and recompute (warn once) rather than risk serving a delta keyed on an empty sha across a real change.
  if (!base || !wtHead) {
    if (!layoutHeadWarned) { layoutHeadWarned = true; console.warn('spec-cli: layout overlay cache bypassed (unreadable merge-base/HEAD), recomputing every read') }
    return worktreeSpecDelta(wtPath, mainRef)
  }
  const key = `${base}\0${wtHead}\0${worktreeSpecSig(wtPath)}`
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
  const records = listSessionIds().map(readRawRecord).filter((r): r is RawRecord => !!r && r.governed)
  const rows = await Promise.all(records.map((r) => {
    const node = r.node ?? (r.branch && r.branch.startsWith(convention.branchPrefix) ? r.branch.slice(convention.branchPrefix.length) : null)
    const base: Worktree = { path: r.worktree_path, branch: r.branch, node, session: r.session_id, status: r.status, isMain: false, ops: [] }
    return guardWorktree<Worktree>(r.worktree_path,
      async (): Promise<Worktree> => ({ ...base, ops: await cachedDelta(r.worktree_path, mainRef) }),
      (): Worktree => ({ ...base, ops: deltaCache.get(r.worktree_path)?.ops ?? [] }))
  }))
  const sessionWorktrees = rows.filter((w): w is Worktree => w !== null)
  // the main checkout row (isMain) — always present, carries no overlay; it anchors the merged tree the board draws.
  const mainRow: Worktree = { path: main, branch: base, node: null, session: null, status: null, isMain: true, ops: [] }
  const worktrees = [mainRow, ...sessionWorktrees]
  // drop cache entries for worktrees no longer in the store (closed sessions), so the map stays bounded.
  const live = new Set(sessionWorktrees.map((w) => w.path))
  for (const k of [...deltaCache.keys()]) if (!live.has(k)) deltaCache.delete(k)
  return { main: convention.main || main || root, convention, worktrees }
}
