// @@@ forum - the LOCAL store of the one Issue object ([[issues]] / [[proposals]] / [[mentions]]). A
// thread IS an Issue whose `store` is 'local' — membership implied by WHERE the file lives, never written
// into it. One thread = one PLAIN markdown file at <main>/.spec/.forum/<id>.md; there is deliberately no
// content-kind taxonomy (a change proposal, an annotation, a Q&A are the same mechanism — the prose says
// what it is). Others sign/reply/discuss like an async chatroom; a supervisor drains it via `spex issues`
// (reading is the port's job, issues.ts — this module owns only the store + its write verbs). Because a
// thread file is NOT named spec.md, the spec walk never nodes it and isSpecMd ignores it — invisible to
// lint / drift / deriveStatus / board with ZERO exemption. The forum lives on the TRUNK, not per-branch:
// reads and writes target the main checkout and commit STRAIGHT to it (--no-verify, provably forum-only),
// so a post-merge thread lands durably even though the author's own branch already merged.
import { readdirSync, existsSync, mkdirSync, writeFileSync, readFileSync, rmdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { git } from './git.js'
import { mainCheckout, envSessionId, readConfig } from './layout.js'
import { dispatchMentions, notifyOriginator, deliveredIds, summarize, type DispatchOutcome, type LoopIn } from './mentions.js'
import type { Issue, Reply } from './issues.js'

const FORUM_REL = '.spec/.forum'

// @@@ the on/off switch - the forum workflow is an OPT-OUTABLE feature (default ON). The single source of
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

// the forum dir on the TRUNK — a fixed path directly under .spec (name-independent, unlike the .config
// system which nests under the named root node). Every read and write goes here.
const forumDir = (): string => join(mainCheckout(), FORUM_REL)
// the author's signature: the effective governed session id (envSessionId handles the claude/codex split).
const currentSession = (): string => envSessionId() || 'unknown'
// a synchronous sleep for the commit-retry backoff (Date/timers-free, safe in any runtime).
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

// ── file format ──────────────────────────────────────────────────────────────────────────────────────
// frontmatter (concern/by/status/nodes/evidence/signers/created) + a prose body, then any replies — each
// preceded by a `<!-- reply: <by> @ <iso> -->` sentinel: invisible in rendered markdown, unambiguous to
// parse. Only the forum writes these files, so a fixed shape is safe. Lists are `key: a, b` scalars so a
// +1 sign is a one-line change.
const REPLY_RE = /^<!-- reply: (.+?) @ (.+?) -->$/

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
    if (rm) { cur = { by: rm[1], at: rm[2], body: '' }; replies.push(cur); continue }
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
  for (const r of p.replies) out += `\n<!-- reply: ${safeScalar(r.by)} @ ${safeScalar(r.at)} -->\n${safeBody(r.body)}\n`
  return out
}

export function loadProposals(): Issue[] {
  const dir = forumDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => parse(e.name.replace(/\.md$/, ''), readFileSync(join(dir, e.name), 'utf8')))
    .sort((a, b) => a.created.localeCompare(b.created))
}

export function loadOne(id: string): Issue {
  const f = join(forumDir(), `${id}.md`)
  if (!existsSync(f)) throw new Error(`no local issue '${id}' (see \`spex issues --all --store local\`)`)
  return parse(id, readFileSync(f, 'utf8'))
}

// a filesystem-safe, readable, collision-free id from the concern (slug + numeric suffix if taken).
function uniqueId(concern: string): string {
  const base = concern.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'issue'
  const dir = forumDir()
  let id = base
  for (let n = 2; existsSync(join(dir, `${id}.md`)); n++) id = `${base}-${n}`
  return id
}

// @@@ forum lock - forum writes contend two ways: git commits share the repo index.lock, and a reply's
// read-modify-write of one thread file loses an update if two race (both read the base, last write wins). A
// single cross-process lock serializes the WHOLE prepare→write→commit, killing both. It is an atomic
// `mkdir` (in .git, never committed); a lock whose holder crashed is stolen after it goes stale. Because the
// commit is `--no-verify` fast (below), serialized forum writes stay quick even under a burst.
function withForumLock<T>(fn: () => T): T {
  const lock = join(mainCheckout(), '.git', 'spexcode-forum.lock')
  for (let i = 0; ; i++) {
    try { mkdirSync(lock); break }                                   // atomic acquire
    catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 20000) rmdirSync(lock) } catch { /* released meanwhile */ }
      sleep(40 + Math.floor(Math.random() * 80))                     // spin with jitter until free / stolen
    }
  }
  try { return fn() } finally { try { rmdirSync(lock) } catch { /* already gone */ } }
}

// prepare (a FRESH read-modify or a new thread) + write + commit a single forum file STRAIGHT to the trunk,
// all under the forum lock so the read-modify-write is atomic. The commit is `--no-verify`: the file is DATA,
// structurally invisible to spec-lint, and the commit is provably forum-only (one .spec/.forum/ path), so the
// pre-commit gate would only pass anyway — running it just burns seconds (tsx cold-start) holding the lock.
// prepare() runs INSIDE the lock, so a reply/sign/resolve reads the current thread, never a stale copy.
function commitForum(message: string, prepare: () => Issue): Issue {
  return withForumLock(() => {
    const p = prepare()
    const root = mainCheckout()
    const rel = `${FORUM_REL}/${p.id}.md`
    mkdirSync(join(root, FORUM_REL), { recursive: true })
    writeFileSync(join(root, rel), serialize(p))
    git(['-C', root, 'add', '--', rel])
    git(['-C', root, 'commit', '--no-verify', '-m', message, '--', rel])
    return p
  })
}

// `author` defaults to the effective session id, but a caller (the dashboard's human write path) may pass
// `'human'` — the write mechanism is identical either way, only the signature differs.
export function propose(concern: string, opts: { nodes?: string[]; body?: string; evidence?: string[]; author?: string } = {}): Issue {
  return commitForum(`issue: ${concern}`, () => ({
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

export function reply(id: string, body: string, author?: string, evidence?: string[]): Issue {
  const by = author || currentSession()
  return commitForum(`issue(${id}): reply by ${by}`, () => {
    const p = loadOne(id)   // fresh read under the lock → no lost-update when replies race
    p.replies.push({ by, at: new Date().toISOString(), body: body.trim() })
    // an anchored annotation carries its frame blob: the reply's evidence hashes accrue onto the THREAD's
    // typed evidence[] (deduped), so the thread stays the one place a video finding's blobs are indexed.
    if (evidence?.length) p.evidence = [...new Set([...p.evidence, ...evidence])]
    return p
  })
}

// @@@ the PROGRAMMATIC forum write surface — the dashboard's human write path calls these (author `'human'`).
// The forum is git-native data, so a human's write goes through the SAME reply/propose the CLI uses (committed
// straight to the trunk), and — because the forum is the programmatic surface — a human's @-mention DOES
// dispatch (a human summons an agent from the issues page, per [[mentions]]). Each returns the written thread
// plus the @-dispatch outcomes so a caller can echo who was notified.
// The two reply deliveries are orthogonal: `evidence?` (f15b) carries a video annotation's frame blobs onto
// the thread; the originator loop-in ([[mentions]]) notifies who raised the thread. Both apply on every reply.
export async function forumReply(id: string, body: string, author: string, evidence?: string[]): Promise<{ thread: Issue; outcomes: DispatchOutcome[]; loopIn: LoopIn | null }> {
  const thread = reply(id, body, author, evidence)
  const node = thread.nodes[0] || null
  const outcomes = await dispatchMentions(body, { threadId: id, node, author, status: thread.status })
  // implicit originator loop-in ([[mentions]]): a courtesy copy to whoever ORIGINATED this thread, if online.
  const loopIn = await notifyOriginator(await threadOriginator(thread), author, body,
    { threadId: id, node, alreadyDelivered: deliveredIds(outcomes) })
  return { thread, outcomes, loopIn }
}

// The session that ORIGINATED a thread ([[mentions]] loop-in target): normally the thread's author (`by`),
// but an EVAL-COMMENT thread's originator is the agent who FILED the reading it discusses, not whoever opened
// the comment thread. Such a thread is a local Issue whose concern is `eval: <node> · <scenario>` (the
// annotator's key — spec-dashboard/src/Annotator.jsx evalConcern); we resolve that to the reading's filer.
// Non-eval threads pay nothing (no yatsu import).
const EVAL_CONCERN_RE = /^eval: (.+?) · (.+)$/   // node first (never contains ' · '), then the scenario (may)
async function threadOriginator(thread: Issue): Promise<string | null> {
  const m = EVAL_CONCERN_RE.exec(thread.concern)
  if (!m) return thread.by
  const { evalReadingFiler } = await import('../../spec-yatsu/src/filing.js')
  return evalReadingFiler(m[1].trim(), m[2].trim())
}

export async function forumPost(
  concern: string,
  opts: { nodes?: string[]; body?: string; evidence?: string[]; author: string },
): Promise<{ thread: Issue; outcomes: DispatchOutcome[] }> {
  const thread = propose(concern, { nodes: opts.nodes, body: opts.body, evidence: opts.evidence, author: opts.author })
  const outcomes = await dispatchMentions(opts.body || concern, { threadId: thread.id, node: thread.nodes[0] || null, author: opts.author, status: thread.status })
  return { thread, outcomes }
}

export function sign(id: string): string[] {
  const by = currentSession()
  return commitForum(`issue(${id}): signed by ${by}`, () => {
    const p = loadOne(id)
    if (!p.signers.includes(by)) p.signers.push(by)
    return p
  }).signers
}

const RESOLUTIONS = new Set(['accepted', 'rejected', 'landed'])
export function resolve(id: string, as: string): string {
  if (!RESOLUTIONS.has(as)) throw new Error(`resolution must be one of: ${[...RESOLUTIONS].join(' | ')}`)
  commitForum(`issue(${id}): resolve ${as}`, () => {
    const p = loadOne(id)
    p.status = as
    return p
  })
  return as
}

// the post-merge nudge TEXT ([[proposals]]) — produced HERE so the toggle and the wording live in one place;
// the post-merge git hook is a thin caller that just echoes this. Returns '' when the feature is OFF, so the
// hook prints nothing.
export function nudge(node: string): string {
  if (!proposalsEnabled()) return ''
  return [
    '── issues ─────────────────────────────────────────────────────────',
    `Your work (${node || 'this node'}) just landed. Two forum checks before you close:`,
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
    'A supervisor drains the forum later. (Advisory — skip if nothing is owed.)',
    '───────────────────────────────────────────────────────────────────',
  ].join('\n')
}

// ───────────────────────── CLI ─────────────────────────
const fl = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const VALUE_FLAGS = new Set(['--node', '--body', '--as', '--evidence'])
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
      console.log(`forum workflow ${sub.toUpperCase()} — spexcode.json proposals.enabled = ${sub === 'on'}${sub === 'on' ? '' : ' (post-merge nudge silenced; dashboard issues view hidden)'}`)
      return 0
    }
    if (sub === 'status') { console.log(`forum workflow is ${proposalsEnabled() ? 'ON' : 'OFF'}`); return 0 }
    if (sub === 'reply') {
      const id = bare(args.slice(1))[0]
      const body = readBody(args)
      if (!id || !body) { console.error('usage: spex propose reply <issue-id> --body -|<text> [--evidence <hash>…]'); return 2 }
      // the ONE store-routed reply verb ([[issues]]): a forge id posts a real comment through the driver,
      // a local id commits to the forum — the same command either way (dynamic import: no static cycle).
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
    console.log(`proposed '${p.id}'${p.nodes.length ? ` (re: ${p.nodes.join(', ')})` : ''} — committed to the forum; read it with \`spex issues\``)
    const s = summarize(await dispatchMentions(p.body || concern, { threadId: p.id, node: p.nodes[0] || null, author: p.by, status: p.status }))
    if (s) console.log(`  ${s}`)
    return 0
  } catch (e) {
    console.error(`spex propose: ${e instanceof Error ? e.message : e}`)
    return 1
  }
}
