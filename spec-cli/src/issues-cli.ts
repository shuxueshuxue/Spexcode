import { readFileSync } from 'node:fs'
import { closeIssue, createIssue, findIssue, isRemark, mergedIssues, promote, replyIssue, type ForgeSlice, type Issue } from './issues.js'
import { FORGE_DRIVERS, forgeDriverFor, resolveForgeHost } from '../../spec-forge/src/drivers.js'
import { currentSession, issuesEnabled, remarkOnHost, reply, resolveRemark, retractRemark } from './localIssues.js'
import { summarize } from './mentions.js'
import { loadSpecsLite } from './specs.js'

// @@@ issues-cli - the `spex issue` / `spex remark` CLI surface: argv parsing, console output, exit codes.
// It lives ABOVE the eval layer, which is the whole point. These handlers used to sit in `issues.ts` and
// `localIssues.ts` — modules the eval package imports — and a CLI surface is by definition the topmost layer,
// so hosting one down there gave those files two altitudes at once. That is what held the spec/eval package
// cycle: the loop-in's candidate resolution needs eval knowledge, its only callers were these handlers, and
// they could not reach eval from below it. Nothing here is new logic; it is the same surface at its own height.
//
// It is NOT merged into `cli.ts`: that file is the thin dispatch hub ([[cli-surface]]) whose eighty lazy
// `await import(...)` sites keep one invocation from loading every verb's module. Moving 265 lines of verb
// implementation there would have traded one two-altitude module for another. The hub gains one lazy line
// pointing here instead.

const fl = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const hasFlag = (args: string[], name: string) => args.includes(`--${name}`)

// the CLI's live forge pull — `ls` and `show` own their freshness (a live driver read), degrading LOUDLY
// to local-only (one stderr note) when the forge is unreachable: local reading never hostages on a network.
async function liveForgeSlice(verb: string): Promise<ForgeSlice | null> {
  try {
    const host = resolveForgeHost()
    const driver = forgeDriverFor(host)
    if (!driver) throw new Error(`no driver for this repo's forge host '${host}' (known: ${FORGE_DRIVERS.map((d) => d.host).join(', ')})`)
    const [issues, prs] = await Promise.all([driver.listIssues(), driver.listPRs()])
    return { host: driver.host, state: { issues, prs } }
  } catch (e) {
    console.error(`spex issue ${verb}: forge unreachable — local only (${e instanceof Error ? e.message.split('\n')[0] : e})`)
    return null
  }
}

// the single-issue read behind `spex issue show` AND `GET /api/issues/:id` — find the thread in the SAME
// merged, eval-remark-free read every issue surface consumes (never a second lookup path: an eval-remark
// thread is not an issue, so `show` can't see one either). A local id needs no forge slice; a forge id
// (`<host>#<n>`) reads from the caller-supplied slice (live pull on the CLI, resident cache on the server).

function renderIssue(t: Issue): string {
  const L: string[] = []
  L.push(`${t.concern}  [${t.id}]`)
  L.push(`  ${[t.store, t.status, t.nodes.length ? `re: ${t.nodes.join(', ')}` : '', t.by ? `by ${t.by}` : '', t.created].filter(Boolean).join('  ·  ')}`)
  if (t.url) L.push(`  ${t.url}`)
  if (t.evidence.length) L.push(`  evidence: ${t.evidence.join(', ')}`)
  L.push('', t.body)
  for (const r of t.replies) {
    L.push('', `── ${isRemark(r) ? `remark ${t.id}#${r.rid}${r.resolved ? ` (resolved by ${r.resolvedBy})` : ' (unresolved)'}` : 'reply'}: ${r.by} @ ${r.at} ──`)
    L.push(r.body)
  }
  return L.join('\n')
}

// `spex issue <verb>` — the ONE issue surface, a noun drawer ([[cli-surface]]). `ls` is THE read over
// every store: the drain view a supervisor/human works from, `[--node id] [--store local|<host>] [--all]
// [--json]`; `show <id>` is the single-thread detail (the same read GET /api/issues/:id serves). The
// write verbs (open|reply — localIssues.ts) are store-routed (`open --store <host>` / a `<host>#<n>` id
// go through the driver); `close` is the store-routed lifecycle verb (the SAME closeIssue the dashboard's
// Close button calls); `promote` is the one cross-store verb; `links` is the read-only forge→spec trace
// (spec-forge). The list imposes NO salience ranking — replies are a signal the drain WEIGHS by judgment,
// never an automatic priority order. The forge slice is a LIVE pull that degrades loudly to local-only.
// (`nudge` left this drawer for `spex internal nudge` — only the post-merge hook calls it; the old
// on|off|status toggle verbs are gone — the switch is the `issues.enabled` settings key.)
export async function runIssues(args: string[]): Promise<number> {
  // the drawer's READ verbs (ls/show) surface a store failure exactly as the writes do
  // ([[issues-store-rename]]'s both-exist teeth): one clean `spex issue: <message>` line + exit 1, never a
  // raw stack — the message carries the repair, the stack is internals. The verbs that already catch with
  // a more specific prefix (open/reply/close/promote) return before this guard ever sees their errors.
  try { return await issueVerbs(args) }
  catch (e) { console.error(`spex issue: ${e instanceof Error ? e.message : e}`); return 1 }
}
async function issueVerbs(args: string[]): Promise<number> {
  if (ISSUE_WRITE_SUBS.has(args[0])) return runIssueWrite(args)
  if (args[0] === 'on' || args[0] === 'off' || args[0] === 'status') {
    // v0.3.0 signpost — report the new home, never run ([[cli-surface]]: a removed spelling only points).
    console.error(`spex: \`spex issue ${args[0]}\` was removed in v0.3.0 — the switch is the \`issues.enabled\` key in spexcode.json (edit the JSON; \`spex guide settings\` documents it, \`spex doctor\` reports its state)`)
    return 2
  }
  if (args[0] === 'show') {
    const id = args[1]
    if (!id || id.startsWith('--')) { console.error('usage: spex issue show <issue-id> [--json]   (a local id, or a forge id like github#12)'); return 2 }
    const nodeIds = loadSpecsLite().map((s) => s.id)
    const t = findIssue(id, id.includes('#') ? await liveForgeSlice('show') : null, nodeIds)
    if (!t) { console.error(`spex issue show: no issue '${id}' (see \`spex issue ls --all\`)`); return 1 }
    console.log(hasFlag(args, 'json') ? JSON.stringify(t, null, 2) : renderIssue(t))
    return 0
  }
  if (args[0] === 'links') {
    const { runIssueLinks } = await import('../../spec-forge/src/cli.js')
    return runIssueLinks(args.slice(1))
  }
  if (args[0] === 'close') {
    // the CLI leg of the ONE close verb ([[issues]] closeIssue — the same routing POST /api/issues/:id/close
    // runs): a local id resolves the thread `landed`, a forge id (`<host>#<n>`) closes the remote issue
    // through the driver. Lifecycle on the issue object, never node state.
    const id = args[1]
    if (!id || id.startsWith('--')) { console.error('usage: spex issue close <issue-id>   (a local id, or a forge id like github#12)'); return 2 }
    try {
      const r = await closeIssue(id)
      console.log(r.store === 'local'
        ? `closed '${id}' — local thread landed`
        : `closed '${id}' on ${r.store}${r.url ? `  ${r.url}` : ''}`)
      return 0
    } catch (e) {
      console.error(`spex issue close: ${e instanceof Error ? e.message : e}`)
      return 1
    }
  }
  if (args[0] === 'promote') {
    const id = args[1]
    if (!id || id.startsWith('--')) { console.error('usage: spex issue promote <local-issue-id>'); return 2 }
    try {
      const r = await promote(id)
      console.log(`promoted '${id}' → ${r.host}#${r.number}  ${r.url}\n  local thread closed landed (permalink recorded in its reply trail)`)
      return 0
    } catch (e) {
      console.error(`spex issue promote: ${e instanceof Error ? e.message : e}`)
      return 1
    }
  }
  if (args[0] !== 'ls') {
    console.error(`spex issue: unknown verb '${args[0]}' — ls | show | open | reply | close | promote | links  (spex help issue)`)
    return 2
  }
  args = args.slice(1)
  const nodeIds = loadSpecsLite().map((s) => s.id)
  const forge = await liveForgeSlice('ls')
  let issues = mergedIssues(forge, nodeIds)
  const node = fl(args, 'node')
  const store = fl(args, 'store')
  if (node) issues = issues.filter((p) => p.nodes.includes(node))
  if (store) issues = issues.filter((p) => p.store === store)
  if (!hasFlag(args, 'all')) issues = issues.filter((p) => p.status === 'open')
  if (hasFlag(args, 'json')) { console.log(JSON.stringify(issues, null, 2)); return 0 }
  if (!issues.length) { console.log(node ? `no issues for node '${node}'` : 'no open issues'); return 0 }
  console.log(`issues — ${issues.length} ${hasFlag(args, 'all') ? 'total' : 'open'}${store ? ` in '${store}'` : ''}${node ? ` for '${node}'` : ''}\n`)
  for (const p of issues) {
    const tags = [p.store, p.status !== 'open' ? `[${p.status}]` : '', p.nodes.length ? `re: ${p.nodes.join(', ')}` : '', p.by ? `by ${p.by}` : ''].filter(Boolean).join('  ·  ')
    console.log(`• ${p.concern}  [${p.id}]`)
    console.log(`    ${tags}`)
    if (p.replies.length) console.log(`    ${p.replies.length} reply(ies) in thread`)
    if (p.url) console.log(`    ${p.url}`)
  }
  if (!issuesEnabled()) console.log('\n(the issues workflow is OFF — set `"issues": { "enabled": true }` in spexcode.json to re-enable writes/nudges)')
  return 0
}

const VALUE_FLAGS = new Set(['--node', '--body', '--evidence', '--scenario', '--code-sha', '--store'])
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

// the local-issue WRITE verbs of the issue drawer (`spex issue <verb>`): open "<concern>" [--store local|<host>] [--node id…]
// [--evidence hash…] [--body -|text], and the id-based reply. Store is a property of the issue,
// never a second command — open and reply route by it (issues.ts createIssue/replyIssue).
export async function runIssueWrite(args: string[]): Promise<number> {
  const sub = args[0]
  try {
    if (sub === 'reply') {
      const id = bare(args.slice(1))[0]
      const body = readBody(args)
      if (!id || !body) { console.error('usage: spex issue reply <issue-id> --body -|<text> [--evidence <hash>…]'); return 2 }
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
    // `open`: start a new issue — STORE-ROUTED through the one creation port ([[issues]] createIssue, the
    // same routine POST /api/issues runs): default local commits to the trunk store; `--store <host>`
    // creates the real forge issue through that store's driver (no promote round-trip when the concern is
    // born forge-visible). The concern is the bare positional(s) after the sub.
    const concern = sub === 'open' ? bare(args.slice(1)).join(' ').trim() : ''
    if (!concern) {
      console.error('usage: spex issue open "<concern>" [--store local|<host>] [--node <id>…] [--evidence <hash>…] [--body -|<text>]\n       spex issue reply|close|promote <issue-id> …')
      return 2
    }
    const r = await (await import('./issues.js')).createIssue(concern, {
      store: fl(args, 'store'),
      nodes: repeated(args, 'node'),
      body: readBody(args),
      evidence: repeated(args, 'evidence'),
    })
    const re = r.nodes.length ? ` (re: ${r.nodes.join(', ')})` : ''
    console.log(r.store === 'local'
      ? `opened '${r.id}'${re} — committed to the local issue store; read it with \`spex issue ls\``
      : `opened '${r.id}' on ${r.store}${re} — ${r.url}`)
    const s = summarize(r.outcomes)
    if (s) console.log(`  ${s}`)
    return 0
  } catch (e) {
    console.error(`spex issue: ${e instanceof Error ? e.message : e}`)
    return 1
  }
}

// the first positionals runIssueWrite handles — the issue drawer routes these to it. Exported so the
// router and the runner can never drift. (`nudge` is not here: it is machine plumbing, called only by the
// post-merge hook as `spex internal nudge`; the on|off|status toggle verbs died in v0.3.0 — the switch is
// the `issues.enabled` settings key.)
export const ISSUE_WRITE_SUBS = new Set(['open', 'reply'])

// ── remark CLI ([[remark-substrate]]) — CLI-first: the whole author→resolve→retract loop, no server needed ──
// `spex remark add <issue-id | <node> --scenario <name>> --body -|<text> [--code-sha <sha>] [--evidence <hash>…]`
// host = a local issue id, OR a <node> with --scenario <name>. Records targetCodeSha (default: worktree HEAD).
export async function runRemark(args: string[]): Promise<number> {
  try {
    const scenario = fl(args, 'scenario')
    const positional = bare(args)[0]
    const body = readBody(args)
    if (!positional || !body) {
      console.error('usage: spex remark add <issue-id | node --scenario name> --body -|<text> [--code-sha <sha>] [--evidence <hash>…]')
      return 2
    }
    // THE FLAG DECIDES THE PARSE ([[cli-surface]] §1): `--scenario` present ⇒ the positional is a NODE id
    // (the remark pins to that node's scenario track); absent ⇒ it is an ISSUE id. Never type-sniffed —
    // a node id and an issue id are both bare slugs, so any "looks like" guess would misroute; the flag
    // is the one unambiguous discriminator, and a wrong host fails loud downstream (unknown issue/node).
    const host = scenario ? { node: positional, scenario } : { issue: positional }
    const r = await remarkOnHost(host, body, { codeSha: fl(args, 'code-sha'), evidence: repeated(args, 'evidence') })
    console.log(`remark ${r.ref}  (against ${r.codeSha.slice(0, 7) || 'HEAD'}) — read it with \`spex issue ls --all\``)
    const s = summarize(r.outcomes, r.loopIn)
    if (s) console.log(`  ${s}`)
    return 0
  } catch (e) {
    console.error(`spex remark add: ${e instanceof Error ? e.message : e}`)
    return 1
  }
}

// `spex remark resolve <remark-ref>` — flip resolved=true (agent-only, never the author, monotonic — see resolveRemark).
export async function runResolve(args: string[]): Promise<number> {
  const ref = bare(args)[0]
  if (!ref) { console.error('usage: spex remark resolve <remark-ref>   (the <thread-id>#<rid> `spex remark add` printed)'); return 2 }
  try {
    const by = currentSession()
    resolveRemark(ref, by)
    console.log(`resolved remark ${ref} — by ${by}`)
    return 0
  } catch (e) { console.error(`spex remark resolve: ${e instanceof Error ? e.message : e}`); return 1 }
}

// `spex remark retract <remark-ref>` — the author withdraws their OWN remark, removing it (author-only — see retractRemark).
export async function runRetract(args: string[]): Promise<number> {
  const ref = bare(args)[0]
  if (!ref) { console.error('usage: spex remark retract <remark-ref>'); return 2 }
  try {
    retractRemark(ref, currentSession())
    console.log(`retracted remark ${ref}`)
    return 0
  } catch (e) { console.error(`spex remark retract: ${e instanceof Error ? e.message : e}`); return 1 }
}
