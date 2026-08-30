import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConnection } from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { git, HARNESS_IDENTITIES, type HarnessId } from '@spexcode/spec-core'
import { shQuote } from './sh.js'
import { writeFileIfChanged } from './file-write.js'
import type { Harness, HarnessArtifacts, PaneProbe, ProcTable } from './harness.js'

const PKG = fileURLToPath(new URL('..', import.meta.url))
const SPEX = join(PKG, 'bin', 'spex.mjs')
const pexec = promisify(execFile)

export type ListenerProbe = 'live' | 'dead' | 'unproven'
const PROVEN_DEAD = new Set(['ECONNREFUSED', 'ENOENT'])
export function listenerAt(path: string, timeoutMs = 800): Promise<ListenerProbe> {
  return new Promise((resolve) => {
    let settled = false
    let c: ReturnType<typeof createConnection> | undefined
    const done = (v: ListenerProbe) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { c?.destroy() } catch { /* */ }
      resolve(v)
    }
    const timer = setTimeout(() => done('unproven'), timeoutMs)
    try { c = createConnection({ path }) } catch { return done('unproven') }
    c.on('connect', () => done('live'))
    c.on('error', (e) => done(PROVEN_DEAD.has((e as NodeJS.ErrnoException).code ?? '') ? 'dead' : 'unproven'))
  })
}
export function headlessTurnFailureShell(harness: string, swallow = true): string {
  return `${shQuote(SPEX)} internal session-turn-fail "$SPEXCODE_SESSION_ID" ${shQuote(harness)} "$__spex_rc"${swallow ? ' || true' : ''}`
}
// @@@ sessionIdentityEnvVars - every environment variable that names ONE session: the launch-injected record
// id plus each adapter's own `sessionEnvVar`. Adapter-derived, so a new harness needs no edit here. A
// per-session process is entitled to carry them; a SHARED, project-scoped daemon must not — see the app-server
// spawn below.
export function sessionIdentityEnvVars(): string[] {
  return [...new Set(['SPEXCODE_SESSION_ID', ...HARNESS_IDENTITIES.map((h) => h.sessionEnvVar)])].filter(Boolean)
}
// idempotent replace of the content between sentinels; the user's own content above/below is preserved. The
// comment STYLE is a parameter so ONE primitive serves every managed file — HTML for the md contracts
// (CLAUDE.md/AGENTS.md), `#` for .gitignore — instead of a per-file-type writer. Default = HTML (the md case).
export function writeManagedBlock(file: string, body: string, comment: readonly [string, string] = ['<!-- ', ' -->']): boolean {
  const [open, close] = comment
  const START = `${open}spexcode:start${close}`
  const END = `${open}spexcode:end${close}`
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = `${START}\n${body}\n${END}`
  const cur = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const re = new RegExp(`${esc(START)}[\\s\\S]*?${esc(END)}`)
  const next = re.test(cur) ? cur.replace(re, block) : cur.trim() ? `${cur.replace(/\n*$/, '')}\n\n${block}\n` : `${block}\n`
  return writeFileIfChanged(file, next)
}

// the INVERSE of writeManagedBlock: strip the spexcode sentinel block (with the blank space around it),
// leaving every other byte of the user's file intact. When deleteIfEmpty and nothing but whitespace remains,
// remove the file — it was WHOLLY ours (e.g. a CLAUDE.md that carried only the generated contract block). Same
// comment-style parameter so ONE primitive un-writes every managed file. No-op when the file/block is absent.
export function removeManagedBlock(file: string, comment: readonly [string, string] = ['<!-- ', ' -->'], deleteIfEmpty = false): void {
  if (!existsSync(file)) return
  const [open, close] = comment
  const START = `${open}spexcode:start${close}`
  const END = `${open}spexcode:end${close}`
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\n*${esc(START)}[\\s\\S]*?${esc(END)}\\n*`)
  const cur = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (!re.test(cur)) return
  // remove ONLY our block plus the blank lines writeManagedBlock inserted around it; do NOT normalize the
  // user's OWN whitespace elsewhere — this must leave every other byte intact so it is a faithful INVERSE of
  // writeManagedBlock's append. A global `\n{3,}→\n\n` collapse used to sit here and mutated pre-existing
  // blank-line runs in the user's file, which broke the policy round-trip ([[residence]]): a mode flip
  // and back left a spurious one-line diff on a .gitignore that had internal blank lines. The leading-newline
  // strip is GUARDED the same way: it exists only for a block sitting at the TOP of the file (whose '\n'
  // replacement would otherwise become a leading blank) — a host file that BEGINS with its own blank lines
  // keeps them ([[content-filter]]'s invariant, same bug class as the shim's old unconditional strip).
  const atTop = (re.exec(cur)?.index ?? -1) === 0
  const replaced = cur.replace(re, '\n')
  const out = atTop ? replaced.replace(/^\n+/, '') : replaced
  if (deleteIfEmpty && !out.trim()) { rmSync(file, { force: true }); return }
  writeFileSync(file, out)
}

// @@@ managed-json-hooks - the JSON counterpart of writeManagedBlock/removeManagedBlock, for a shim file the
// host agent SHARES with the user. `.claude/settings.json` (and `.native harness/hooks.json`, `.zcode/settings.json`)
// is the user's project config — permissions, env, statusLine, their own hooks — that merely HAPPENS to be
// where the harness also discovers ours. A whole-file write there is silent data loss, and a whole-file
// delete on uninstall makes it permanent for an untracked (gitignored) file. JSON has no comment syntax, so
// the sentinel that scopes ownership is the hook COMMAND itself: every entry we write invokes `dispatch.sh`,
// and ONLY such entries are ever removed. Everything else round-trips — other keys, other events, foreign
// hook groups, and the user's half of a group that mixes both.
const isOurHookEntry = (entry: unknown): boolean =>
  !!entry && typeof entry === 'object' && typeof (entry as { command?: unknown }).command === 'string'
  && (entry as { command: string }).command.includes('dispatch.sh')

// drop OUR entries from one event's group list, keeping every foreign group byte-for-byte and keeping the
// user's half of a mixed group. A group whose entries were all ours disappears with it.
function stripOurHookGroups(list: unknown): unknown[] {
  if (!Array.isArray(list)) return Array.isArray(list) ? list : []
  const kept: unknown[] = []
  for (const group of list) {
    const inner = (group as { hooks?: unknown })?.hooks
    if (!group || typeof group !== 'object' || !Array.isArray(inner)) { kept.push(group); continue }
    const rest = inner.filter((e) => !isOurHookEntry(e))
    if (rest.length === inner.length) kept.push(group)                       // nothing of ours in here
    else if (rest.length) kept.push({ ...(group as object), hooks: rest })   // mixed group — keep their half
  }
  return kept
}

// read a shared shim file as JSON. Absent → {} (we are about to create it). UNPARSEABLE → throw: the file is
// the user's, and overwriting prose we cannot read is exactly the data loss this primitive exists to prevent
// (the harness itself cannot read it either, so the repair is the same one they already need).
function readSharedShim(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {}
  const raw = readFileSync(file, 'utf8')
  if (!raw.trim()) return {}
  // (re-serialization NORMALIZES the host's formatting — 2-space, one member per line. Their CONTENT all
  // round-trips; their layout does not, because no JSON writer can reproduce hand-compacted objects. The one
  // byte-level convention we DO honor is the trailing newline, below.)
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a JSON object')
    return parsed as Record<string, unknown>
  } catch (e) {
    throw new Error(`it is not readable JSON (${(e as Error).message}). SpexCode co-owns only its own hook entries in this file and will not overwrite content it cannot parse — fix the JSON (your harness cannot read it either), then re-run \`spex materialize\`.`)
  }
}

// does this file end with a newline today? A host file keeps its own convention; a file we are about to
// create gets the POSIX one. (Absent → true, so a fresh shim is newline-terminated.)
function trailingNewline(file: string): boolean {
  if (!existsSync(file)) return true
  try { return /\n$/.test(readFileSync(file, 'utf8')) } catch { return true }
}

const hostHooksOf = (host: Record<string, unknown>): Record<string, unknown> => {
  const h = host.hooks
  return h && typeof h === 'object' && !Array.isArray(h) ? h as Record<string, unknown> : {}
}

// MERGE our per-event hook groups into a shared shim file: our previous entries are stripped first (so a
// changed dispatch path or event set self-heals instead of accumulating), then re-appended AFTER the user's
// groups for that event. Every other key keeps its value and its position.
export function writeManagedJsonHooks(file: string, hooks: Record<string, unknown[]>): boolean {
  const eol = trailingNewline(file) ? '\n' : ''
  const host = readSharedShim(file)
  const merged: Record<string, unknown> = {}
  for (const [event, list] of Object.entries(hostHooksOf(host))) {
    const kept = stripOurHookGroups(list)
    if (kept.length) merged[event] = kept
  }
  for (const [event, groups] of Object.entries(hooks))
    merged[event] = [...((merged[event] as unknown[]) ?? []), ...groups]
  return writeFileIfChanged(file, JSON.stringify({ ...host, hooks: merged }, null, 2) + eol)
}

// the INVERSE: strip our entries, leave every other byte of meaning intact. The file is REMOVED only when
// nothing of the user's remains ({} after our entries go) — the same deleteIfEmpty rule removeManagedBlock
// applies to a wholly-ours CLAUDE.md, and safe here only because the write half no longer clobbers.
export function removeManagedJsonHooks(file: string): void {
  if (!existsSync(file)) return
  const eol = trailingNewline(file) ? '\n' : ''
  let host: Record<string, unknown>
  try { host = readSharedShim(file) } catch { return }   // unparseable → not provably ours, leave it alone
  const rest = { ...host }
  const merged: Record<string, unknown> = {}
  for (const [event, list] of Object.entries(hostHooksOf(host))) {
    const kept = stripOurHookGroups(list)
    if (kept.length) merged[event] = kept
  }
  if (Object.keys(merged).length) rest.hooks = merged
  else delete rest.hooks
  if (!Object.keys(rest).length) { rmSync(file, { force: true }); return }
  writeFileIfChanged(file, JSON.stringify(rest, null, 2) + eol)
}

// does anything of the USER's survive in this shared shim file — the JSON analogue of the contract files'
// host-content test ([[residence]])? Everything except our identity-stamped hook entries counts. This is what
// decides the file's residence: wholly ours → hidden by the tree's ignore block exactly like any other machine
// fact; carrying their content → left visible, because hiding a file the user owns is data-loss shaped.
export function sharedShimHasHostContent(file: string): boolean {
  if (!existsSync(file)) return false
  let host: Record<string, unknown>
  try { host = readSharedShim(file) } catch { return true }   // unreadable → assume theirs
  const rest = { ...host }
  delete rest.hooks
  if (Object.keys(rest).length) return true
  return Object.values(hostHooksOf(host)).some((list) => stripOurHookGroups(list).length > 0)
}

// the identity stamp on every generated skill/agent file. It is what lets BOTH halves of the pass tell our
// artifact from a same-named file the user wrote: the erase phase refuses to delete an unstamped file, and
// the write phase refuses to overwrite one ([[harness-delivery]]).
export const GENERATED_MARK = '<!-- spexcode:generated -->'
// is this path ours to replace or remove? An absent file is (nothing to lose); a present one only when it
// carries the stamp. Unreadable → not provably ours.
export function isGeneratedArtifact(file: string): boolean {
  if (!existsSync(file)) return true
  try { return readFileSync(file, 'utf8').includes(GENERATED_MARK) } catch { return false }
}

// the shim for one harness: every event → `SPEX='…' bash <dispatch> <harnessId> <Event>`. The harness id is
// baked in so dispatch.sh can export SPEXCODE_HARNESS (the detector for the shell side). SPEX is inherited by
// the cli-needing handlers.
export function buildShim(id: HarnessId, events: readonly string[], dispatch: string, spex: string): { content: string; hooks: Record<string, unknown[]>; cmd: (e: string) => string } {
  const cmd = (e: string) => `SPEX='${spex}' bash ${dispatch} ${id} ${e}`
  const hooks: Record<string, unknown[]> = {}
  for (const e of events) hooks[e] = [{ hooks: [{ type: 'command', command: cmd(e) }] }]
  // `content` stays the standalone rendering (what a shim file that is wholly ours would hold); `hooks` is
  // what the merge writer folds into the user's shared config file. Every buildShim harness is 'shared-json'.
  return { content: JSON.stringify({ hooks }, null, 2), hooks, cmd }
}

// is this file git-tracked in proj? (guards cleanHarness's deleteIfEmpty; env-stripped git, never throws)
function isTrackedFile(proj: string, f: string): boolean {
  try { git(['-C', proj, 'ls-files', '--error-unmatch', f]); return true } catch { return false }
}

// @@@ cleanHarness - the shared clean: the inverse of materialize's per-harness write, expressed PURELY
// through the adapter's own path methods so it can never drift from what write put there. Each step is
// surgical, gated on a SpexCode identity stamp: the contract files carry the managed-block sentinels; the shim
// is a generated file whose command line names our `dispatch.sh`; the trust is a sentinel-delimited config
// block; the skill/agent files sit at name-scoped paths reconstructed from `arts`. So it removes ONLY our own
// blocks and our own named products — never a user's CLAUDE.md/AGENTS.md prose, a hand-made settings.json, or
// a sibling skill/agent the user added, and NEVER any .spec data.
export function cleanHarness(h: Harness, proj: string, arts: HarnessArtifacts, preserveProject = false): void {
  // deleteIfEmpty ONLY for an UNTRACKED contract file: a wholly-ours generated file goes; a HOST-TRACKED file
  // that carried nothing but our block (an empty committed CLAUDE.md we folded into) is stripped back to its
  // pristine emptiness but never deleted — deleting a tracked file would surface as a `D` in the host's status.
  for (const f of h.contractFiles(proj)) removeManagedBlock(f, ['<!-- ', ' -->'], !isTrackedFile(proj, f))
  const shim = h.shimFile(proj)
  // a SHARED config file is un-written entry by entry (and disappears only if nothing of the user's is left);
  // a file wholly ours goes whole, gated on its own dispatch.sh stamp.
  if (h.shimScope === 'tree' || !preserveProject) {
    if (h.shimOwnership === 'shared-json') removeManagedJsonHooks(shim)
    else if (existsSync(shim) && readFileSync(shim, 'utf8').includes('dispatch.sh')) rmSync(shim, { force: true })
  }
  const anchor = h.worktreeHookAnchor(proj)   // the linked-worktree anchor copy, same identity gate as the shim
  if (anchor && existsSync(anchor) && readFileSync(anchor, 'utf8').includes('dispatch.sh')) rmSync(anchor, { force: true })
  if (!preserveProject) h.removeTrust(proj)
  // the name sweep is identity-gated exactly like the stamp sweep: a live spec node named `distill` says
  // WHICH path to look at, never that the file sitting there is ours. A user's same-named skill (the write
  // half now refuses to overwrite it) must survive our uninstall.
  const sd = h.skillDir(proj)
  const stamped = (f: string) => existsSync(f) && isGeneratedArtifact(f)
  if (sd) for (const n of arts.skills) {
    if (stamped(join(sd, n, 'SKILL.md'))) rmSync(join(sd, n), { recursive: true, force: true })
  }
  const ad = h.agentDir(proj)
  if (ad) for (const n of arts.agents) {
    if (stamped(join(ad, `${n}.md`))) rmSync(join(ad, `${n}.md`), { force: true })
  }
}

// the shared descendant-tree walk: does a process matching `re` live BELOW the pane pid? (The pane pid itself
// is the shell, so descendants only.) Pure over the caller's one ps snapshot.
export function paneTreeRuns(pane: PaneProbe | undefined, re: RegExp): boolean {
  if (!pane?.panePid || !pane.procs?.size) return false
  const kids = new Map<number, number[]>()
  for (const [pid, p] of pane.procs) {
    const arr = kids.get(p.ppid); if (arr) arr.push(pid); else kids.set(p.ppid, [pid])
  }
  const stack = [...(kids.get(pane.panePid) ?? [])]   // descendants only — the pane pid itself is the shell
  while (stack.length) {
    const pid = stack.pop()!
    const comm = pane.procs.get(pid)?.comm ?? ''
    if (re.test(comm.slice(comm.lastIndexOf('/') + 1))) return true   // basename — macOS ps comm is a full path
    const c = kids.get(pid); if (c) stack.push(...c)
  }
  return false
}
// ONE whole-box pid→(ppid, comm) snapshot (a single `ps` spawn) — the table paneTreeRuns walks. Owned here
// (beside its consumers) and shared with sessions.ts's liveSnapshot, so the two probe layers can never parse
// ps differently. A failed/timed-out ps returns an empty table: the callers read that as not-provably-running.
export async function procSnapshot(timeoutMs = 4000): Promise<ProcTable> {
  const t: ProcTable = new Map()
  let out = ''
  try { ({ stdout: out } = await pexec('ps', ['-eo', 'pid=,ppid=,comm='], { timeout: timeoutMs, killSignal: 'SIGKILL' })) } catch { return t }
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (m) t.set(Number(m[1]), { ppid: Number(m[2]), comm: m[3].trim() })
  }
  return t
}


export function noLaunchEnv(): string[] { return [] }
