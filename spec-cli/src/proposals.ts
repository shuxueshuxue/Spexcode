// @@@ the local issue store - the LOCAL store of the one Issue object ([[issues]] / [[proposals]] /
// [[mentions]]). A thread IS an Issue whose `store` is 'local' — membership implied by WHERE the file lives,
// never written into it. One thread = one PLAIN markdown file at <main>/.spec/.issues/<id>.md; there is
// deliberately no content-kind taxonomy (a change proposal, an annotation, a Q&A are the same mechanism —
// the prose says what it is). Others sign/reply/discuss like an async chatroom; a supervisor drains it via
// `spex issues` (reading is the port's job, issues.ts — this module owns only the store + its write verbs).
// Because a thread file is NOT named spec.md, the spec walk never nodes it and isSpecMd ignores it —
// invisible to lint / drift / deriveStatus / board with ZERO exemption. The store lives on the TRUNK, not
// per-branch: reads and writes target the main checkout and commit STRAIGHT to it (--no-verify, provably
// store-only), so a post-merge thread lands durably even though the author's own branch already merged.
// The on-disk dir was historically `.spec/.forum`; a one-shot self-migration ([[issues-store-rename]])
// renames any legacy `.spec/.forum` to `.spec/.issues` on the first store touch after a toolchain update.
import { readdirSync, existsSync, mkdirSync, writeFileSync, readFileSync, rmdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { git, headSha, repoRoot } from './git.js'
import { mainCheckout, envSessionId, readConfig } from './layout.js'
import { dispatchMentions, notifyOriginator, deliveredIds, summarize, type DispatchOutcome, type LoopIn } from './mentions.js'
import type { Issue, Reply } from './issues.js'

const LOCAL_STORE_REL = '.spec/.issues'
// the pre-rename dir ([[issues-store-rename]]); ensureStoreMigrated() renames it to LOCAL_STORE_REL once.
const LEGACY_STORE_REL = '.spec/.forum'

// @@@ the on/off switch - the issues workflow is an OPT-OUTABLE feature (default ON). The single source of
// truth is `spexcode.json`'s `proposals.enabled` (the same settings file that carries every other toggle),
// read via readConfig so a machine-local `spexcode.local.json` can override it. OFF silences the post-merge
// nudge (and, in the dashboard, hides the issues view); the raw write verbs stay usable, since running one
// is explicit consent. `spex propose on|off` flips the flag on disk — effective immediately, no commit
// needed, because readConfig reads the working tree. The dashboard toggle is a thin wrapper over this same
// switch.
export const proposalsEnabled = (): boolean => readConfig(mainCheckout()).proposals?.enabled ?? true

function setEnabled(on: boolean): void {
  const f = join(mainCheckout(), 'spexcode.json')
  const cfg = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}
  cfg.proposals = { ...(cfg.proposals || {}), enabled: on }
  writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n')
}

const list = (v: string | undefined): string[] =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []

// the local issue store dir on the TRUNK — a fixed path directly under .spec (name-independent, unlike the
// .config system which nests under the named root node). Every read and write goes here.
const localStoreDir = (): string => join(mainCheckout(), LOCAL_STORE_REL)
// the author's signature: the effective governed session id (envSessionId handles the claude/codex split).
const currentSession = (): string => envSessionId() || 'unknown'
// a synchronous sleep for the commit-retry backoff (Date/timers-free, safe in any runtime).
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

// ── file format ──────────────────────────────────────────────────────────────────────────────────────
// frontmatter (concern/by/status/nodes/evidence/signers/created) + a prose body, then any replies — each
// preceded by a `<!-- reply: <by> @ <iso> -->` sentinel: invisible in rendered markdown, unambiguous to
// parse. Only the store writes these files, so a fixed shape is safe. Lists are `key: a, b` scalars so a
// +1 sign is a one-line change.
//
// A REMARK ([[remark-substrate]]) is a reply carrying extra state, appended to the SAME sentinel as a
// ` :: <space-joined k=v attrs>` tail (a plain reply has no tail → parses unchanged, backward compatible):
//   rid=<id>            stable per-remark id — its presence marks the reply a remark
//   sha=<targetCodeSha> the reading the remark was authored against
//   resolved=<by>@<at>  present only once resolved (absent ⟹ resolved:false)
const REPLY_RE = /^<!-- reply: (.+?) @ (.+?)(?: :: (.+))? -->$/

function parse(id: string, text: string): Issue {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const fm: Record<string, string> = {}
  for (const line of (m ? m[1] : '').split('\n')) {
    const mm = line.match(/^([a-zA-Z]+):\s*(.*)$/)
    if (mm) fm[mm[1]] = mm[2].trim()
  }
  const body: string[] = []
  const replies: Reply[] = []
  let cur: Reply | null = null
  for (const line of (m ? m[2] : text).replace(/^\n+/, '').split('\n')) {
    const rm = line.match(REPLY_RE)
    if (rm) { cur = { by: rm[1], at: rm[2], body: '', ...parseRemarkAttrs(rm[3]) }; replies.push(cur); continue }
    if (cur) cur.body += (cur.body ? '\n' : '') + line
    else body.push(line)
  }
  return {
    id,
    store: 'local',
    concern: fm.concern || id,
    by: fm.by || 'unknown',
    status: fm.status || 'open',
    nodes: list(fm.nodes),
    signers: list(fm.signers),
    created: fm.created || '',
    body: body.join('\n').trim(),
    replies: replies.map((r) => ({ ...r, body: r.body.trim() })),
    evidence: list(fm.evidence),
  }
}

// user body text must never FORGE a reply sentinel: a line matching `<!-- reply: … -->` in a body would be
// re-read as a thread boundary, splitting the thread and truncating the body. Neutralize the marker in user
// content (a zero-width space breaks the `<!-- reply:` prefix — invisible on render, idempotent), so only
// serialize's OWN sentinels parse as boundaries. Frontmatter scalars are single-line-stripped for the same
// reason (a newline/`---` in a concern can't break the block).
const safeBody = (t: string): string => t.trim().replace(/<!-- reply:/g, '<!--​reply:')
const safeScalar = (t: string): string => t.replace(/[\r\n]+/g, ' ').trim()

// the ` :: k=v k=v` remark tail on a reply sentinel ↔ the reply's remark fields. `undefined` attrs (a plain
// reply) → no remark fields; `rid` present → the reply IS a remark ([[remark-substrate]]). Values are
// space-free (ids, a codeSha, a session id, an ISO instant), so a space-split is unambiguous.
function parseRemarkAttrs(attrs: string | undefined): Partial<Reply> {
  if (!attrs) return {}
  const kv = new Map<string, string>()
  for (const tok of attrs.trim().split(/\s+/)) { const i = tok.indexOf('='); if (i > 0) kv.set(tok.slice(0, i), tok.slice(i + 1)) }
  if (!kv.has('rid')) return {}
  const out: Partial<Reply> = { rid: kv.get('rid'), targetCodeSha: kv.get('sha') ?? '', resolved: false }
  const r = kv.get('resolved')
  if (r) { const at = r.indexOf('@'); out.resolved = true; out.resolvedBy = r.slice(0, at); out.resolvedAt = r.slice(at + 1) }
  return out
}
function serializeRemarkAttrs(r: Reply): string {
  if (r.rid === undefined) return ''
  const parts = [`rid=${r.rid}`, `sha=${r.targetCodeSha ?? ''}`]
  if (r.resolved) parts.push(`resolved=${r.resolvedBy ?? ''}@${r.resolvedAt ?? ''}`)
  return ` :: ${parts.join(' ')}`
}

function serialize(p: Issue): string {
  const fm = [
    `concern: ${safeScalar(p.concern)}`,
    `by: ${safeScalar(p.by)}`,
    `status: ${safeScalar(p.status)}`,
    p.nodes.length ? `nodes: ${p.nodes.join(', ')}` : '',
    p.evidence.length ? `evidence: ${p.evidence.join(', ')}` : '',
    p.signers.length ? `signers: ${p.signers.join(', ')}` : '',
    `created: ${p.created}`,
  ].filter(Boolean)
  let out = `---\n${fm.join('\n')}\n---\n\n${safeBody(p.body)}\n`
  for (const r of p.replies) out += `\n<!-- reply: ${safeScalar(r.by)} @ ${safeScalar(r.at)}${serializeRemarkAttrs(r)} -->\n${safeBody(r.body)}\n`
  return out
}

export function loadProposals(): Issue[] {
  ensureStoreMigrated()   // read path: a pre-rename deployment migrates on first read, so no thread is lost
  const dir = localStoreDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => parse(e.name.replace(/\.md$/, ''), readFileSync(join(dir, e.name), 'utf8')))
    .sort((a, b) => a.created.localeCompare(b.created))
}

export function loadOne(id: string): Issue {
  ensureStoreMigrated()
  const f = join(localStoreDir(), `${id}.md`)
  if (!existsSync(f)) throw new Error(`no local issue '${id}' (see \`spex issues --all --store local\`)`)
  return parse(id, readFileSync(f, 'utf8'))
}

// a filesystem-safe, readable, collision-free id from the concern (slug + numeric suffix if taken).
function uniqueId(concern: string): string {
  const base = concern.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'issue'
  const dir = localStoreDir()
  let id = base
  for (let n = 2; existsSync(join(dir, `${id}.md`)); n++) id = `${base}-${n}`
  return id
}

// @@@ store lock - local-issue writes contend two ways: git commits share the repo index.lock, and a
// reply's read-modify-write of one thread file loses an update if two race (both read the base, last write
// wins). A single cross-process lock serializes the WHOLE prepare→write→commit, killing both. It is an
// atomic `mkdir` (in .git, never committed); a lock whose holder crashed is stolen after it goes stale.
// Because the commit is `--no-verify` fast (below), serialized writes stay quick even under a burst. The
// lock FILE keeps its historical `spexcode-forum.lock` name ON PURPOSE: during the one-shot store-dir
// migration ([[issues-store-rename]]) an old and a new toolchain can run against the SAME checkout at once,
// and they mutually exclude only while contending on the SAME lock name — renaming it would open exactly
// the migration race the lock exists to close.
let lockHeld = false   // re-entrancy guard so ensureStoreMigrated() no-ops when reached from inside a hold
function withStoreLock<T>(fn: () => T): T {
  const lock = join(mainCheckout(), '.git', 'spexcode-forum.lock')
  for (let i = 0; ; i++) {
    try { mkdirSync(lock); break }                                   // atomic acquire
    catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 20000) rmdirSync(lock) } catch { /* released meanwhile */ }
      sleep(40 + Math.floor(Math.random() * 80))                     // spin with jitter until free / stolen
    }
  }
  lockHeld = true
  try { return fn() } finally { lockHeld = false; try { rmdirSync(lock) } catch { /* already gone */ } }
}

// @@@ one-shot store-dir migration ([[issues-store-rename]]) - the local issue store's on-disk dir was
// historically `.spec/.forum`; it is now `.spec/.issues`. Any pre-rename deployment migrates ITSELF on the
// first store touch after its toolchain updates: a single committed `git mv` on the trunk, so a thread's
// whole reply history reads identically afterwards (`git log --follow` traces through the rename — the data
// is git, and a rename preserves it). Called at every store entrypoint BEFORE the lock is taken; it takes
// the lock itself to do the mv, so the whole find→check→mv is atomic against a concurrent first-touch burst:
// exactly ONE mv commit, because a racer that waited on the lock re-checks under it and finds nothing to do.
// Fast path: no legacy dir → instant, no lock (the common case after migration / on a fresh repo). Both
// dirs present (pathological) → fail LOUD with the repair, never a silent merge.
function ensureStoreMigrated(): void {
  if (lockHeld) return                                     // inside a hold: an outer entrypoint already ran this
  const root = mainCheckout()
  if (!existsSync(join(root, LEGACY_STORE_REL))) return    // fresh or already-migrated: nothing to do (no lock)
  withStoreLock(() => {
    const r = mainCheckout()
    const legacy = join(r, LEGACY_STORE_REL), current = join(r, LOCAL_STORE_REL)
    if (!existsSync(legacy)) return                        // a racer migrated it while we waited on the lock
    if (existsSync(current)) throw new Error(
      `both ${LEGACY_STORE_REL} and ${LOCAL_STORE_REL} exist in ${r} — refusing to auto-merge the local ` +
      `issue store. Reconcile by hand: move any threads from ${LEGACY_STORE_REL} into ${LOCAL_STORE_REL}, ` +
      `then \`git rm -r ${LEGACY_STORE_REL} && git commit\`, and re-run.`)
    git(['-C', r, 'mv', LEGACY_STORE_REL, LOCAL_STORE_REL])
    git(['-C', r, 'commit', '--no-verify', '-m', `issues: store dir ${LEGACY_STORE_REL} → ${LOCAL_STORE_REL}`,
      '--', LEGACY_STORE_REL, LOCAL_STORE_REL])
  })
}

// write + commit ONE store file STRAIGHT to the trunk. The commit is `--no-verify`: the file is DATA,
// structurally invisible to spec-lint, and the commit is provably store-only (one .spec/.issues/ path), so the
// pre-commit gate would only pass anyway — running it just burns seconds (tsx cold-start) holding the lock.
// MUST run while holding withStoreLock — it is the write half of a locked read-modify-write; its callers
// (commitStore, findOrCreateEvalThread) own the lock, so it never acquires one itself (mkdir is not re-entrant).
function writeStoreFile(p: Issue, message: string): void {
  const root = mainCheckout()
  const rel = `${LOCAL_STORE_REL}/${p.id}.md`
  mkdirSync(join(root, LOCAL_STORE_REL), { recursive: true })
  writeFileSync(join(root, rel), serialize(p))
  git(['-C', root, 'add', '--', rel])
  git(['-C', root, 'commit', '--no-verify', '-m', message, '--', rel])
}

// prepare (a FRESH read-modify or a new thread) + write + commit a single store file, all under the store
// lock so the read-modify-write is atomic. prepare() runs INSIDE the lock, so a reply/sign/resolve reads the
// current thread, never a stale copy. A pre-rename store migrates first (before the lock — ensure takes it).
function commitStore(message: string, prepare: () => Issue): Issue {
  ensureStoreMigrated()
  return withStoreLock(() => {
    const p = prepare()
    writeStoreFile(p, message)
    return p
  })
}

// `author` defaults to the effective session id, but a caller (the dashboard's human write path) may pass
// `'human'` — the write mechanism is identical either way, only the signature differs.
export function propose(concern: string, opts: { nodes?: string[]; body?: string; evidence?: string[]; author?: string } = {}): Issue {
  return commitStore(`issue: ${concern}`, () => ({
    id: uniqueId(concern),   // minted INSIDE the lock, so two racing posts can't pick the same id
    store: 'local',
    concern,
    by: opts.author || currentSession(),
    status: 'open',
    nodes: opts.nodes || [],
    signers: [],
    created: new Date().toISOString(),
    body: (opts.body || `(no detail given — ${concern})`).trim(),
    replies: [],
    evidence: opts.evidence || [],
  }))
}

// mint a per-thread-unique remark id (retry on the rare collision within one thread). Short + readable so a
// `<thread-id>#<rid>` ref is typeable; stable, so a resolve/retract never lands on the wrong remark.
function mintRid(existing: Set<string>): string {
  let rid: string
  do { rid = 'r' + Math.random().toString(36).slice(2, 6) } while (existing.has(rid))
  return rid
}

// a REMARK ([[remark-substrate]]) rides the SAME committed reply write, just stamping the remark fields: a
// fresh unresolved bit + a minted stable rid + the codeSha it was authored against. Absent `remark` this is
// an ordinary reply, unchanged. Returns the thread; the new reply is its last, so a caller reads back its rid.
export function reply(id: string, body: string, author?: string, evidence?: string[], remark?: { targetCodeSha: string }): Issue {
  const by = author || currentSession()
  return commitStore(remark ? `remark(${id}): by ${by}` : `issue(${id}): reply by ${by}`, () => {
    const p = loadOne(id)   // fresh read under the lock → no lost-update when replies race
    const post: Reply = { by, at: new Date().toISOString(), body: body.trim() }
    if (remark) { post.rid = mintRid(new Set(p.replies.map((r) => r.rid).filter((x): x is string => !!x))); post.targetCodeSha = remark.targetCodeSha; post.resolved = false }
    p.replies.push(post)
    // an anchored annotation carries its frame blob: the reply's evidence hashes accrue onto the THREAD's
    // typed evidence[] (deduped), so the thread stays the one place a video finding's blobs are indexed.
    if (evidence?.length) p.evidence = [...new Set([...p.evidence, ...evidence])]
    return p
  })
}

// @@@ the PROGRAMMATIC store write surface — the dashboard's human write path calls these (author `'human'`).
// The store is git-native data, so a human's write goes through the SAME reply/propose the CLI uses (committed
// straight to the trunk), and — because the store is the programmatic surface — a human's @-mention DOES
// dispatch (a human summons an agent from the issues page, per [[mentions]]). Each returns the written thread
// plus the @-dispatch outcomes so a caller can echo who was notified.
// The two reply deliveries are orthogonal: `evidence?` (f15b) carries a video annotation's frame blobs onto
// the thread; the originator loop-in ([[mentions]]) notifies who raised the thread. Both apply on every reply.
export async function replyLocalIssue(id: string, body: string, author: string, evidence?: string[], remark?: { targetCodeSha: string }): Promise<{ thread: Issue; outcomes: DispatchOutcome[]; loopIn: LoopIn | null }> {
  const thread = reply(id, body, author, evidence, remark)
  const node = thread.nodes[0] || null
  const outcomes = await dispatchMentions(body, { threadId: id, node, author, status: thread.status })
  // implicit originator loop-in ([[mentions]] / [[remark-substrate]] R3): a courtesy copy down the fallback
  // chain — the reading's filer, then the node's governing session — delivered to the first online link.
  const loopIn = await notifyOriginator(await threadOriginators(thread), author, body,
    { threadId: id, node, alreadyDelivered: deliveredIds(outcomes) })
  return { thread, outcomes, loopIn }
}

// The FALLBACK CHAIN of candidates a reply loops in ([[mentions]] loop-in / [[remark-substrate]] R3's dispatch
// clause), tried in order until one is online. A plain thread's only candidate is its author (`by`). An
// EVAL-COMMENT thread (concern `eval: <node> · <scenario>`, the eval-remark track) chains: the agent who FILED
// the reading the remark judges FIRST, then — when that filer is offline/absent — the NODE's governing session,
// so an unresolved remark still REACHES an agent who can act on it. This is notification only; it resolves
// nothing (R3: resolve is a deliberate `spex resolve`). Non-eval threads pay nothing (no yatsu/specs import).
const EVAL_CONCERN_RE = /^eval: (.+?) · (.+)$/   // node first (never contains ' · '), then the scenario (may)
async function threadOriginators(thread: Issue): Promise<(string | null)[]> {
  const m = EVAL_CONCERN_RE.exec(thread.concern)
  if (!m) return [thread.by]
  const node = m[1].trim(), scenario = m[2].trim()
  const { evalReadingFiler } = await import('../../spec-yatsu/src/filing.js')
  return [evalReadingFiler(node, scenario), await nodeGoverningSession(node)]
}

// A node's governing session — the `session` its spec resolves to (the Session: trailer of its latest version,
// else the frontmatter `session:` fallback; specs.ts owns that derivation). The fallback link when a reading's
// filer is unreachable. null when the node is unknown or has no governing session.
async function nodeGoverningSession(nodeId: string): Promise<string | null> {
  const { loadSpecs } = await import('./specs.js')
  return (await loadSpecs()).find((s) => s.id === nodeId)?.session ?? null
}

export async function postLocalIssue(
  concern: string,
  opts: { nodes?: string[]; body?: string; evidence?: string[]; author: string },
): Promise<{ thread: Issue; outcomes: DispatchOutcome[] }> {
  const thread = propose(concern, { nodes: opts.nodes, body: opts.body, evidence: opts.evidence, author: opts.author })
  const outcomes = await dispatchMentions(opts.body || concern, { threadId: thread.id, node: thread.nodes[0] || null, author: opts.author, status: thread.status })
  return { thread, outcomes }
}

export function sign(id: string): string[] {
  const by = currentSession()
  return commitStore(`issue(${id}): signed by ${by}`, () => {
    const p = loadOne(id)
    if (!p.signers.includes(by)) p.signers.push(by)
    return p
  }).signers
}

const RESOLUTIONS = new Set(['accepted', 'rejected', 'landed'])
export function resolve(id: string, as: string): string {
  if (!RESOLUTIONS.has(as)) throw new Error(`resolution must be one of: ${[...RESOLUTIONS].join(' | ')}`)
  commitStore(`issue(${id}): resolve ${as}`, () => {
    const p = loadOne(id)
    p.status = as
    return p
  })
  return as
}

// ── remarks ([[remark-substrate]]) ──────────────────────────────────────────────────────────────────
// A remark is a reply carrying a resolvable bit, attached to a HOST: a local issue, or a scenario keyed by
// (node, scenario). The scenario track is NOT a new store — it is the annotator's lazy eval thread, keyed by
// its `eval: <node> · <scenario>` concern; a remark reuses it, creating it on first remark as a stub
// container (every remark is a reply, never the thread body, so the resolved bit always lives in one place).
const evalConcernKey = (node: string, scenario: string): string => `eval: ${node} · ${scenario}`

// find-or-create the ONE scenario thread for (node, scenario), keyed by its eval concern, ATOMICALLY under
// the store lock. R4 says a scenario's remark track lives ONCE — but a concurrent first-remark burst is a
// normal dogfood situation (SpexCode runs parallel workers), and if the not-found read sat OUTSIDE the lock
// two racers could both read "absent" and both create, minting a second thread whose remarks are invisible
// to the concern key (a silent teeth blind spot). Holding one lock across both the find AND the create closes
// that window: a racer either sees the thread the first created, or is the first. The stub is a pure
// container (its body carries a [[wiki-link]], never an @-mention), so it needs no async dispatch — a
// synchronous create suffices, and staying sync is exactly what lets it share the lock hold.
function findOrCreateEvalThread(node: string, scenario: string, author: string): Issue {
  ensureStoreMigrated()   // migrate before the lock (ensure takes it itself; never nest a store-lock hold)
  const concern = evalConcernKey(node, scenario)
  return withStoreLock(() => {
    const existing = loadProposals().find((t) => t.store === 'local' && t.concern === concern)
    if (existing) return existing
    const p: Issue = {
      id: uniqueId(concern), store: 'local', concern, by: author, status: 'open',
      nodes: [node], signers: [], created: new Date().toISOString(),
      body: `Remarks on the \`${scenario}\` eval of [[${node}]].`, replies: [], evidence: [],
    }
    writeStoreFile(p, `issue: ${concern}`)
    return p
  })
}

function resolveRemarkHost(host: { issue?: string; node?: string; scenario?: string }, author: string): string {
  if (host.scenario) {
    const node = host.node
    if (!node) throw new Error('a scenario remark needs a node plus --scenario <name>')
    return findOrCreateEvalThread(node, host.scenario, author).id
  }
  if (!host.issue) throw new Error('a remark needs a host: an issue id, or a node with --scenario <name>')
  return loadOne(host.issue).id   // throws loudly if the issue doesn't exist
}

// author a remark on a host — the ONE write both the CLI (`spex remark`) and the server call. Stamps the
// codeSha it was authored against (the worktree HEAD by default — R2). Returns the `<thread-id>#<rid>` ref.
export async function remarkOnHost(
  host: { issue?: string; node?: string; scenario?: string },
  body: string,
  opts: { codeSha?: string; author?: string; evidence?: string[] } = {},
): Promise<{ ref: string; rid: string; codeSha: string; thread: Issue; outcomes: DispatchOutcome[]; loopIn: LoopIn | null }> {
  const author = opts.author || currentSession()
  const codeSha = opts.codeSha || headSha(repoRoot())
  const id = resolveRemarkHost(host, author)
  const { thread, outcomes, loopIn } = await replyLocalIssue(id, body, author, opts.evidence, { targetCodeSha: codeSha })
  const rid = thread.replies[thread.replies.length - 1].rid!
  return { ref: `${id}#${rid}`, rid, codeSha, thread, outcomes, loopIn }
}

// a remark ref is `<thread-id>#<rid>`; the thread id (a store slug) never contains '#', so split on the last.
function parseRemarkRef(ref: string): { id: string; rid: string } {
  const i = ref.lastIndexOf('#')
  if (i <= 0 || i === ref.length - 1) throw new Error(`bad remark ref '${ref}' — expected <thread-id>#<rid> (the id \`spex remark\` printed)`)
  return { id: ref.slice(0, i), rid: ref.slice(i + 1) }
}

// resolve a remark (R3): a DELIBERATE call, agent-only (the dashboard's `human` is rejected — a human
// RETRACTS their own, resolve is a second party's judgment), NEVER the author (no self-resolve), and
// MONOTONIC (no un-resolve — a regression is a NEW remark). `by` is the resolving party.
export function resolveRemark(ref: string, by: string): { thread: Issue; rid: string } {
  const { id, rid } = parseRemarkRef(ref)
  const thread = commitStore(`remark(${id}#${rid}): resolved by ${by}`, () => {
    const p = loadOne(id)
    const r = p.replies.find((x) => x.rid === rid)
    if (!r) throw new Error(`no remark '${ref}' in that thread`)
    if (!by || by === 'human' || by === 'unknown') throw new Error(`resolve is agent-only (needs a real session identity, got '${by || 'none'}'): a human withdraws their own remark with \`spex retract\`, not resolve`)
    if (r.resolved) throw new Error(`remark '${ref}' is already resolved — monotonic: a regression is a NEW remark, never an un-resolve`)
    if (r.by === by) throw new Error(`refusing to self-resolve '${ref}': the author (${by}) may not resolve their own remark — resolve is a second party's deliberate judgment`)
    r.resolved = true; r.resolvedBy = by; r.resolvedAt = new Date().toISOString()
    return p
  })
  return { thread, rid }
}

// retract a remark (R3): the AUTHOR withdraws their OWN remark, removing it — but ONLY while it is
// unresolved. Only the author may retract; and once a SECOND party has deliberately resolved it, the remark
// (and that recorded judgment) is part of the record — retract may not erase it. This makes R3's
// monotonicity two-sided: resolve can't be undone, and retract can't back-door an un-resolve by deleting the
// resolved remark. A regression after a resolve is a NEW remark, never a retract-and-reraise.
export function retractRemark(ref: string, by: string): { thread: Issue; rid: string } {
  const { id, rid } = parseRemarkRef(ref)
  const thread = commitStore(`remark(${id}#${rid}): retracted by ${by}`, () => {
    const p = loadOne(id)
    const idx = p.replies.findIndex((x) => x.rid === rid)
    if (idx < 0) throw new Error(`no remark '${ref}' in that thread`)
    if (p.replies[idx].by !== by) throw new Error(`only the author (${p.replies[idx].by}) may retract '${ref}' — you are '${by}'`)
    if (p.replies[idx].resolved) throw new Error(`refusing to retract '${ref}': it was resolved by ${p.replies[idx].resolvedBy} — a resolved remark is part of the record (monotonic), retract only withdraws an UNRESOLVED remark; a regression is a NEW remark`)
    p.replies.splice(idx, 1)
    return p
  })
  return { thread, rid }
}

// the post-merge nudge TEXT ([[proposals]]) — produced HERE so the toggle and the wording live in one place;
// the post-merge git hook is a thin caller that just echoes this. Returns '' when the feature is OFF, so the
// hook prints nothing.
export function nudge(node: string): string {
  if (!proposalsEnabled()) return ''
  return [
    '── issues ─────────────────────────────────────────────────────────',
    `Your work (${node || 'this node'}) just landed. Two issue checks before you close:`,
    '',
    '1. CLOSE what you finished. An issue whose work just landed is resolved, not',
    '   left open — the open set is the OUTSTANDING work, so a stale open reads as a',
    '   lie:  spex issues --store local     then   spex propose resolve <id> --as landed',
    '',
    '2. RECORD only what OUTLIVES this task — a concern you are NOT acting on now:',
    '   an off-mainline smell / awkward boundary / wish, or a trivial-but-must-not-',
    "   forget to-do that doesn't earn a spec node. NOT a bug tracker (that is the",
    '   spec graph + the forge), NOT your assigned task or a fix you are about to',
    '   make — those need no issue. Only the taste that would otherwise evaporate:',
    '     spex issues                          # read first — sign/reply if already raised',
    '     spex propose "<concern>" [--node <id>]   # else open one',
    'A supervisor drains the store later. (Advisory — skip if nothing is owed.)',
    '───────────────────────────────────────────────────────────────────',
  ].join('\n')
}

// ───────────────────────── CLI ─────────────────────────
const fl = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const VALUE_FLAGS = new Set(['--node', '--body', '--as', '--evidence', '--scenario', '--code-sha'])
// bare positionals, skipping flags + their values.
function bare(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const t = args[i]
    if (t.startsWith('--')) { if (VALUE_FLAGS.has(t)) i++; continue }
    out.push(t)
  }
  return out
}
// `--body -` reads stdin; `--body "text"` is literal; absent → undefined.
function readBody(args: string[]): string | undefined {
  const v = fl(args, 'body')
  if (v === undefined) return undefined
  return v === '-' ? readFileSync(0, 'utf8') : v
}
// a repeatable value flag: every `--<name> <value>` pair, in order.
const repeated = (args: string[], name: string): string[] =>
  args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : [])).filter(Boolean) as string[]

// `spex propose "<concern>" [--node id…] [--evidence hash…] [--body -|text]`, the sub-verbs
// reply | sign | resolve (id-based, any local issue), and the feature toggle on | off | status.
export async function runPropose(args: string[]): Promise<number> {
  const sub = args[0]
  try {
    if (sub === 'on' || sub === 'off') {
      setEnabled(sub === 'on')
      console.log(`issues workflow ${sub.toUpperCase()} — spexcode.json proposals.enabled = ${sub === 'on'}${sub === 'on' ? '' : ' (post-merge nudge silenced; dashboard issues view hidden)'}`)
      return 0
    }
    if (sub === 'status') { console.log(`issues workflow is ${proposalsEnabled() ? 'ON' : 'OFF'}`); return 0 }
    if (sub === 'reply') {
      const id = bare(args.slice(1))[0]
      const body = readBody(args)
      if (!id || !body) { console.error('usage: spex propose reply <issue-id> --body -|<text> [--evidence <hash>…]'); return 2 }
      // the ONE store-routed reply verb ([[issues]]): a forge id posts a real comment through the driver,
      // a local id commits to the store — the same command either way (dynamic import: no static cycle).
      const r = await (await import('./issues.js')).replyIssue(id, body, { evidence: repeated(args, 'evidence') })
      console.log(r.store === 'local'
        ? `replied to '${id}' — ${r.replies?.length} post(s) in thread`
        : `commented on '${id}' — ${r.url}`)
      const s = summarize(r.outcomes, r.loopIn)
      if (s) console.log(`  ${s}`)
      return 0
    }
    if (sub === 'sign') {
      const id = bare(args.slice(1))[0]
      if (!id) { console.error('usage: spex propose sign <issue-id>'); return 2 }
      console.log(`signed '${id}' — signers: ${sign(id).join(', ')}`)
      return 0
    }
    if (sub === 'resolve') {
      const id = bare(args.slice(1))[0]
      const as = fl(args, 'as')
      if (!id || !as) { console.error('usage: spex propose resolve <issue-id> --as accepted|rejected|landed'); return 2 }
      console.log(`resolved '${id}' → ${resolve(id, as)}`)
      return 0
    }
    if (sub === 'nudge') {
      // internal: the post-merge hook calls this to print the (toggle-aware) nudge for a merged node.
      const text = nudge(bare(args.slice(1))[0] || '')
      if (text) console.log(text)
      return 0
    }
    // default: open a new local issue. The concern is the bare positional(s).
    const concern = bare(args).join(' ').trim()
    if (!concern) {
      console.error('usage: spex propose "<concern>" [--node <id>…] [--evidence <hash>…] [--body -|<text>]\n       spex propose reply|sign|resolve <issue-id> …  |  on|off|status')
      return 2
    }
    const p = propose(concern, { nodes: repeated(args, 'node'), body: readBody(args), evidence: repeated(args, 'evidence') })
    console.log(`proposed '${p.id}'${p.nodes.length ? ` (re: ${p.nodes.join(', ')})` : ''} — committed to the local issue store; read it with \`spex issues\``)
    const s = summarize(await dispatchMentions(p.body || concern, { threadId: p.id, node: p.nodes[0] || null, author: p.by, status: p.status }))
    if (s) console.log(`  ${s}`)
    return 0
  } catch (e) {
    console.error(`spex propose: ${e instanceof Error ? e.message : e}`)
    return 1
  }
}

// ── remark CLI ([[remark-substrate]]) — CLI-first: the whole author→resolve→retract loop, no server needed ──
// `spex remark <host> --body -|<text> [--code-sha <sha>] [--scenario <name>] [--evidence <hash>…]`
// host = a local issue id, OR a <node> with --scenario <name>. Records targetCodeSha (default: worktree HEAD).
export async function runRemark(args: string[]): Promise<number> {
  try {
    const scenario = fl(args, 'scenario')
    const positional = bare(args)[0]
    const body = readBody(args)
    if (!positional || !body) {
      console.error('usage: spex remark <issue-id | node --scenario name> --body -|<text> [--code-sha <sha>] [--evidence <hash>…]')
      return 2
    }
    const host = scenario ? { node: positional, scenario } : { issue: positional }
    const r = await remarkOnHost(host, body, { codeSha: fl(args, 'code-sha'), evidence: repeated(args, 'evidence') })
    console.log(`remark ${r.ref}  (against ${r.codeSha.slice(0, 7) || 'HEAD'}) — read it with \`spex issues --all\``)
    const s = summarize(r.outcomes, r.loopIn)
    if (s) console.log(`  ${s}`)
    return 0
  } catch (e) {
    console.error(`spex remark: ${e instanceof Error ? e.message : e}`)
    return 1
  }
}

// `spex resolve <remark-ref>` — flip resolved=true (agent-only, never the author, monotonic — see resolveRemark).
export async function runResolve(args: string[]): Promise<number> {
  const ref = bare(args)[0]
  if (!ref) { console.error('usage: spex resolve <remark-ref>   (the <thread-id>#<rid> `spex remark` printed)'); return 2 }
  try {
    const by = currentSession()
    resolveRemark(ref, by)
    console.log(`resolved remark ${ref} — by ${by}`)
    return 0
  } catch (e) { console.error(`spex resolve: ${e instanceof Error ? e.message : e}`); return 1 }
}

// `spex retract <remark-ref>` — the author withdraws their OWN remark, removing it (author-only — see retractRemark).
export async function runRetract(args: string[]): Promise<number> {
  const ref = bare(args)[0]
  if (!ref) { console.error('usage: spex retract <remark-ref>'); return 2 }
  try {
    retractRemark(ref, currentSession())
    console.log(`retracted remark ${ref}`)
    return 0
  } catch (e) { console.error(`spex retract: ${e instanceof Error ? e.message : e}`); return 1 }
}
