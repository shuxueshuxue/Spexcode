// @@@ forum - the git-native discussion/annotation layer over the spec graph ([[proposals]] / [[mentions]]).
// A thread is one PLAIN markdown file at <main>/.spec/.forum/<id>.md, carrying a `kind`: a `proposal` (taste
// that wants change — recorded when work merges, so it doesn't evaporate) or a `note` (a durable annotation /
// heads-up / Q&A on a node, no change-intent). Others sign/reply/discuss like an async chatroom; a supervisor
// drains it. Because a thread file is NOT named spec.md, the spec walk never nodes it and isSpecMd ignores it
// — invisible to lint / drift / deriveStatus / board with ZERO exemption. The forum lives on the TRUNK, not
// per-branch: reads and writes target the main checkout and commit STRAIGHT to it (main-guard admits a
// forum-only commit), so a post-merge thread lands durably even though the author's own branch already
// merged, and every thread is always present to read and reply to — no cross-worktree union to reconcile.
import { readdirSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { git } from './git.js'
import { mainCheckout, envSessionId, readConfig } from './layout.js'

const FORUM_REL = '.spec/.forum'

// @@@ the on/off switch - the forum is an OPT-OUTABLE feature (default ON). The single source of truth is
// `spexcode.json`'s `proposals.enabled` (the same settings file that carries every other toggle), read via
// readConfig so a machine-local `spexcode.local.json` can override it. OFF silences the post-merge nudge (and,
// in the dashboard, hides the forum view); the raw `spex propose`/`proposals` commands stay usable, since
// running one is explicit consent. `spex proposals on|off` flips the flag on disk — effective immediately,
// no commit needed, because readConfig reads the working tree. The dashboard toggle is a thin wrapper over
// this same switch.
export const proposalsEnabled = (): boolean => readConfig(mainCheckout()).proposals?.enabled ?? true

function setEnabled(on: boolean): void {
  const f = join(mainCheckout(), 'spexcode.json')
  const cfg = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}
  cfg.proposals = { ...(cfg.proposals || {}), enabled: on }
  writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n')
}

export type Reply = { by: string; at: string; body: string }
export type Kind = 'proposal' | 'note'
export type Proposal = {
  id: string
  kind: Kind
  concern: string
  by: string
  status: string
  nodes: string[]
  signers: string[]
  created: string
  body: string
  replies: Reply[]
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
// frontmatter (concern/by/status/nodes/signers/created) + a prose body, then any replies — each preceded by
// a `<!-- reply: <by> @ <iso> -->` sentinel: invisible in rendered markdown, unambiguous to parse. Only the
// forum writes these files, so a fixed shape is safe. Lists are `key: a, b` scalars so a +1 sign is a
// one-line change.
const REPLY_RE = /^<!-- reply: (.+?) @ (.+?) -->$/

function parse(id: string, text: string): Proposal {
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
    kind: fm.kind === 'note' ? 'note' : 'proposal',
    concern: fm.concern || id,
    by: fm.by || 'unknown',
    status: fm.status || 'open',
    nodes: list(fm.nodes),
    signers: list(fm.signers),
    created: fm.created || '',
    body: body.join('\n').trim(),
    replies: replies.map((r) => ({ ...r, body: r.body.trim() })),
  }
}

function serialize(p: Proposal): string {
  const fm = [
    `kind: ${p.kind}`,
    `concern: ${p.concern}`,
    `by: ${p.by}`,
    `status: ${p.status}`,
    p.nodes.length ? `nodes: ${p.nodes.join(', ')}` : '',
    p.signers.length ? `signers: ${p.signers.join(', ')}` : '',
    `created: ${p.created}`,
  ].filter(Boolean)
  let out = `---\n${fm.join('\n')}\n---\n\n${p.body.trim()}\n`
  for (const r of p.replies) out += `\n<!-- reply: ${r.by} @ ${r.at} -->\n${r.body.trim()}\n`
  return out
}

export function loadProposals(): Proposal[] {
  const dir = forumDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => parse(e.name.replace(/\.md$/, ''), readFileSync(join(dir, e.name), 'utf8')))
    .sort((a, b) => a.created.localeCompare(b.created))
}

function loadOne(id: string): Proposal {
  const f = join(forumDir(), `${id}.md`)
  if (!existsSync(f)) throw new Error(`no forum thread '${id}' (see \`spex proposals --all\`)`)
  return parse(id, readFileSync(f, 'utf8'))
}

// a filesystem-safe, readable, collision-free id from the concern (slug + numeric suffix if taken).
function uniqueId(concern: string): string {
  const base = concern.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'proposal'
  const dir = forumDir()
  let id = base
  for (let n = 2; existsSync(join(dir, `${id}.md`)); n++) id = `${base}-${n}`
  return id
}

// write + commit a single forum file STRAIGHT to the trunk. main-guard admits a commit touching ONLY
// .spec/.forum/** (the forum is data, not contract), and prepare-commit-msg stamps the Session: trailer.
// Scoped add/commit so no unrelated work rides along. Retry on an index-lock race — many agents may append
// forum posts to the shared trunk during their merge turns; a lost lock is transient, not a real failure.
function writeAndCommit(p: Proposal, message: string) {
  const root = mainCheckout()
  const rel = `${FORUM_REL}/${p.id}.md`
  mkdirSync(join(root, FORUM_REL), { recursive: true })
  writeFileSync(join(root, rel), serialize(p))
  git(['-C', root, 'add', '--', rel])
  for (let attempt = 0; ; attempt++) {
    try { git(['-C', root, 'commit', '-m', message, '--', rel]); return }
    catch (e) { if (attempt >= 4) throw e; sleep(150) }
  }
}

export function propose(concern: string, opts: { nodes?: string[]; body?: string; kind?: Kind } = {}): Proposal {
  const kind: Kind = opts.kind === 'note' ? 'note' : 'proposal'
  const p: Proposal = {
    id: uniqueId(concern),
    kind,
    concern,
    by: currentSession(),
    status: 'open',
    nodes: opts.nodes || [],
    signers: [],
    created: new Date().toISOString(),
    body: (opts.body || `(no detail given — ${concern})`).trim(),
    replies: [],
  }
  writeAndCommit(p, `${kind}: ${concern}`)
  return p
}

export function reply(id: string, body: string): Proposal {
  const p = loadOne(id)
  const by = currentSession()
  p.replies.push({ by, at: new Date().toISOString(), body: body.trim() })
  writeAndCommit(p, `proposal(${id}): reply by ${by}`)
  return p
}

export function sign(id: string): string[] {
  const p = loadOne(id)
  const by = currentSession()
  if (!p.signers.includes(by)) p.signers.push(by)
  writeAndCommit(p, `proposal(${id}): signed by ${by}`)
  return p.signers
}

const RESOLUTIONS = new Set(['accepted', 'rejected', 'landed'])
export function resolve(id: string, as: string): string {
  if (!RESOLUTIONS.has(as)) throw new Error(`resolution must be one of: ${[...RESOLUTIONS].join(' | ')}`)
  const p = loadOne(id)
  p.status = as
  writeAndCommit(p, `proposal(${id}): resolve ${as}`)
  return as
}

// the post-merge nudge TEXT ([[proposals]]) — produced HERE so the toggle and the wording live in one place;
// the post-merge git hook is a thin caller that just echoes this. Returns '' when the feature is OFF, so the
// hook prints nothing.
export function nudge(node: string): string {
  if (!proposalsEnabled()) return ''
  return [
    '── proposal forum ─────────────────────────────────────────────────',
    `Your work (${node || 'this node'}) just landed. Before you close: did anything feel`,
    'OFF this session — a smell, an awkward boundary, a wish — even unrelated to your',
    'task? Record it so your taste reaches the codebase instead of evaporating:',
    '  spex proposals                          # read the forum first (it is non-blind)',
    '  spex propose sign <id>                  # +1 if your concern is already raised',
    '  spex propose reply <id> --body -        # add your angle to an existing thread',
    '  spex propose "<concern>" [--node <id>]   # else open a new one',
    'A supervisor drains the forum into real work later. (Advisory — skip if nothing nagged.)',
    '───────────────────────────────────────────────────────────────────',
  ].join('\n')
}

// ───────────────────────── CLI ─────────────────────────
const fl = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const hasFlag = (args: string[], name: string) => args.includes(`--${name}`)
const VALUE_FLAGS = new Set(['--node', '--body', '--as', '--kind'])
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

// `spex propose "<concern>" [--node id…] [--body -|text]` and the sub-verbs reply | sign | resolve.
export async function runPropose(args: string[]): Promise<number> {
  const sub = args[0]
  try {
    if (sub === 'reply') {
      const id = bare(args.slice(1))[0]
      const body = readBody(args)
      if (!id || !body) { console.error('usage: spex propose reply <proposal-id> --body -|<text>'); return 2 }
      const p = reply(id, body)
      console.log(`replied to '${id}' — ${p.replies.length} post(s) in thread`)
      return 0
    }
    if (sub === 'sign') {
      const id = bare(args.slice(1))[0]
      if (!id) { console.error('usage: spex propose sign <proposal-id>'); return 2 }
      console.log(`signed '${id}' — signers: ${sign(id).join(', ')}`)
      return 0
    }
    if (sub === 'resolve') {
      const id = bare(args.slice(1))[0]
      const as = fl(args, 'as')
      if (!id || !as) { console.error('usage: spex propose resolve <proposal-id> --as accepted|rejected|landed'); return 2 }
      console.log(`resolved '${id}' → ${resolve(id, as)}`)
      return 0
    }
    if (sub === 'nudge') {
      // internal: the post-merge hook calls this to print the (toggle-aware) forum nudge for a merged node.
      const text = nudge(bare(args.slice(1))[0] || '')
      if (text) console.log(text)
      return 0
    }
    // default: open a new proposal. The concern is the bare positional(s).
    const concern = bare(args).join(' ').trim()
    if (!concern) {
      console.error('usage: spex propose "<concern>" [--node <id>…] [--body -|<text>]\n       spex propose reply|sign|resolve <proposal-id> …')
      return 2
    }
    const nodes = args.flatMap((a, i) => (a === '--node' ? [args[i + 1]] : [])).filter(Boolean) as string[]
    const p = propose(concern, { nodes, body: readBody(args) })
    console.log(`proposed '${p.id}'${p.nodes.length ? ` (re: ${p.nodes.join(', ')})` : ''} — committed to the forum; read it with \`spex proposals\``)
    return 0
  } catch (e) {
    console.error(`spex propose: ${e instanceof Error ? e.message : e}`)
    return 1
  }
}

// `spex note "<annotation>" [--node id…] [--body -|text]` — open a `kind: note` thread: a durable annotation /
// heads-up / Q&A on a node, no change-intent. Same store + reply/sign/resolve verbs as a proposal (those are
// id-based and kind-agnostic); only the creation verb differs, so the verb IS the kind.
export async function runNote(args: string[]): Promise<number> {
  const concern = bare(args).join(' ').trim()
  if (!concern) { console.error('usage: spex note "<annotation>" [--node <id>…] [--body -|<text>]'); return 2 }
  const nodes = args.flatMap((a, i) => (a === '--node' ? [args[i + 1]] : [])).filter(Boolean) as string[]
  try {
    const p = propose(concern, { nodes, body: readBody(args), kind: 'note' })
    console.log(`noted '${p.id}'${p.nodes.length ? ` (on ${p.nodes.join(', ')})` : ''} — committed to the forum; read it with \`spex proposals\``)
    return 0
  } catch (e) {
    console.error(`spex note: ${e instanceof Error ? e.message : e}`)
    return 1
  }
}

// `spex proposals [--node id] [--all] [--json]` — read the forum (a supervisor's / human's DRAIN view). It
// lists concerns as raw data with their recurrence signals (signers, replies); it deliberately imposes NO
// salience ranking — recurrence is a signal the drain WEIGHS by judgment, never an automatic priority order.
export async function runProposals(args: string[]): Promise<number> {
  // the on/off switch (default ON) — `spex proposals on|off` flips spexcode.json's proposals.enabled, `status`
  // reports it. Handled before the read view, and never gated by the flag itself.
  const verb = args[0]
  if (verb === 'on' || verb === 'off' || verb === 'enable' || verb === 'disable') {
    const on = verb === 'on' || verb === 'enable'
    setEnabled(on)
    console.log(`proposal forum ${on ? 'ON' : 'OFF'} — spexcode.json proposals.enabled = ${on}${on ? '' : ' (post-merge nudge silenced; dashboard view hidden)'}`)
    return 0
  }
  if (verb === 'status') { console.log(`proposal forum is ${proposalsEnabled() ? 'ON' : 'OFF'}`); return 0 }
  let threads = loadProposals()
  const node = fl(args, 'node')
  const kind = fl(args, 'kind')          // proposal | note — default: all kinds (it is the whole forum)
  if (node) threads = threads.filter((p) => p.nodes.includes(node))
  if (kind) threads = threads.filter((p) => p.kind === kind)
  if (!hasFlag(args, 'all')) threads = threads.filter((p) => p.status === 'open')
  if (hasFlag(args, 'json')) { console.log(JSON.stringify(threads, null, 2)); return 0 }
  if (!threads.length) { console.log(node ? `no forum threads for node '${node}'` : 'the forum is empty'); return 0 }
  console.log(`forum — ${threads.length} ${hasFlag(args, 'all') ? 'total' : 'open'}${kind ? ` ${kind}(s)` : ''}${node ? ` for '${node}'` : ''}\n`)
  for (const p of threads) {
    const tags = [`${p.kind}`, p.status !== 'open' ? `[${p.status}]` : '', p.nodes.length ? `re: ${p.nodes.join(', ')}` : '', `by ${p.by}`].filter(Boolean).join('  ·  ')
    console.log(`• ${p.concern}  [${p.id}]`)
    console.log(`    ${tags}`)
    if (p.signers.length) console.log(`    +${p.signers.length} signed: ${p.signers.join(', ')}`)
    if (p.replies.length) console.log(`    ${p.replies.length} reply(ies) in thread`)
  }
  return 0
}
