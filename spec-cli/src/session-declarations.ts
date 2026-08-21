// @@@ worker declarations ([[cli-surface]] / [[state]]) - these are the three porcelain writes an
// agent performs from its own worktree. Keep their session resolution, no-record diagnosis, durable note
// receipt, and state write together so the CLI hub only selects the verb and never becomes a second owner.

type DeclarationVerb = 'done' | 'park' | 'ask'

const DECLARED = ' — recorded; the human sees it in the dashboard. This declaration remains in the session timeline; your next tool call flips only the current graph state back to active (the mark-active hook, by design).'
// appended ONLY to a propose-close declaration: a worktree about to be discarded may still own ephemeral things the agent started to test this change; nudge (not gate) it to reclaim them before the worktree goes, keyed on whether the thing should outlive the task — never on who started it (a deliberately long-running service / a production build is started-by-you yet must be left alone). Project-agnostic on purpose.
// @@@ the sweep never includes THIS session - the nudge names sessions as sweepable, and it is read at the one moment a session is thinking about closing. Said loosely it reads as permission to close yourself, which deletes the worktree the reading agent is running in. So the target is scoped to sessions the agent spawned, and the exclusion is stated rather than implied.
const CLOSE_CLEANUP = '\n\nBefore this worktree closes, check whether you left anything running that you started to test this change — a background process, a dev or preview server, a bound port, a throwaway session you spawned. If nothing depends on it anymore, shut it down, or it keeps running as an orphan. Leave anything meant to keep running: a service you deliberately stood up, a production build, anything other work relies on. What matters is whether it still needs to exist after this task, not whether you started it. If unsure, leave it. This sweep never includes THIS session: you have PROPOSED that the human close it, and closing your own session would delete the worktree you are running in. This is a reminder to check, not a required step.'

const flag = (argv: readonly string[], name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

function nothingProposalTrap(): never {
  console.error('`spex session done --propose nothing` is an intended trap: no state was recorded.')
  console.error('Choose the true destination:')
  console.error('  `merge` - committed spec and code have not landed in `main`.')
  console.error('  `close` - work is complete: it has landed (or had nothing to land), is verified, and no worktree, human decision/follow-up, or posted artifact needs human inspection.')
  console.error('  `ask` - a human reply, direction, or decision is needed, including a reported finding/recommendation, handoff, or posted artifact inspection.')
  console.error('  `park` - a managed delivery or background job will resume a named next action; watching terminal children is not a wake-up.')
  process.exit(2)
}

// Shared with `spex internal session-*`: machine lifecycle producers use the same record-resolution and
// diagnostic rules, but they do not own any porcelain declaration verb.
export async function sessionStateKit(sessionId?: string) {
  const s = await import('./sessions.js')
  const l = await import('@spexcode/spec-core')
  const { existsSync, writeFileSync } = await import('node:fs')
  // the agent-authored state writers resolve WHICH session by id: a `--session <id>` flag (the lifecycle
  // hooks pass it, parsed from the payload, since they no longer have a cwd `.session`) wins, else the
  // harness env var (ownSessionId — the agent's own `spex session …` carries the harness session id).
  const sess = sessionId
  // @@@ no-record diagnosis ([[state]]) - the session store resolves from the CURRENT directory (runtimeRoot
  // ← the cwd's git common dir), so the classic declaration failure is a cd OUTSIDE the session's project —
  // and a bare "no session record" told the author none of that (field-reported). Name the actual cause and
  // route the fix; each branch is a distinct situation, distinguished by probing the same store the writer used.
  const noRecord = (): string => {
    // cwd probe FIRST: outside a git repo nothing below can resolve — not the store, and not even the env
    // id (ownSessionId's alias walk reads the store too) — so diagnose the cwd before touching either.
    let ids: string[] | null
    try { ids = l.listSessionIds() } catch { ids = null }
    if (ids === null) return `no session record — declarations resolve the session store from the CURRENT directory, and ${process.cwd()} is not inside a git repository. cd back into the session's worktree and re-declare.`
    const wid = sess || s.ownSessionId()   // safe now: the store just resolved, so the alias walk cannot throw
    if (!wid) return 'no session record — no session id to write: this shell carries no harness session env (SPEXCODE_SESSION_ID / CLAUDE_CODE_SESSION_ID) and no --session was given. Pass --session <id> (spex session ls lists ids).'
    if (ids.length === 0) return `no session record for ${wid.slice(0, 8)} — declarations resolve the session store from the CURRENT directory, and the project at ${process.cwd()} has no sessions at all: you are in a different project's checkout. cd back into the session's worktree and re-declare.`
    return `no session record for ${wid.slice(0, 8)} — this project's store (resolved from ${process.cwd()}) holds ${ids.length} session(s) but not this one: a wrong --session id, or you are declaring from a different project's checkout. cd back into the session's worktree and re-declare, or pass a valid --session <id> (spex session ls).`
  }
  // a state writer from a non-repo cwd throws git's not-a-repo before it can return false — map exactly
  // that throw to the no-record path (noRecord re-probes and names the cwd); anything else stays loud.
  // A record that exists but CANNOT carry state (unreadable bytes, or a worktree that is gone) is its own
  // answer: the writer refused on purpose and already knows why, so that reason is what the caller prints —
  // never the no-record diagnosis, which would send the author chasing a wrong cwd ([[sessions-core]]).
  const mark = (fn: () => boolean): { ok: boolean; reason?: string } => {
    try { return { ok: fn() } }
    catch (e) {
      if (e instanceof s.SessionRecordUnusable) return { ok: false, reason: e.message }
      if (/not a git repository/i.test(String((e as any)?.stderr ?? e))) return { ok: false }
      throw e
    }
  }
  // Taught once per record: the CLI's explicit NOTE column is the only note display that cuts prose.
  const noteEcho = (note?: string): string => {
    if (!note) return ''
    const tableCut = s.displayWidth(note) > s.NOTE_BOARD_LIMIT
    if (!tableCut) return ''
    const wid = sess || s.ownSessionId()
    const rid = wid ? (l.readAliasedRawRecord(wid)?.session_id ?? wid) : null   // sentinel lives in the RECORD's dir, so an aliased codex id lands on the same file
    if (rid) {
      const sentinel = l.sessionArtifactPath(rid, 'note-echo-taught')
      try {
        if (existsSync(sentinel)) return ''
        writeFileSync(sentinel, `${new Date().toISOString()}\n`)   // only reached on a successful declaration (the echo rides the success branch)
      } catch { /* unreadable/unwritable store dir → fall through and teach again; never block the echo */ }
    }
    return `\nyour note is ${note.length} chars — the session table's NOTE column shows only the first ${s.NOTE_BOARD_LIMIT} display columns. the full text IS recorded, and readable via spex session review ${(wid || '<your-session>').slice(0, 8)} / spex session ls --json. (said once — later cut notes won't repeat this.)`
  }
  return { s, sess, noRecord, mark, noteEcho }
}

export async function runSessionDeclaration(verb: DeclarationVerb, argv: readonly string[] = process.argv): Promise<void> {
  const sessionId = flag(argv, 'session')
  const note = flag(argv, 'note')
  if (verb === 'done') {
    // `merge`/`close` are awaiting declarations; `nothing` is an intentional no-write correction trap.
    const proposal = (flag(argv, 'propose') as any) || 'nothing'
    if (proposal === 'nothing') nothingProposalTrap()
    const { s, sess, mark, noRecord, noteEcho } = await sessionStateKit(sessionId)
    let acceptance = ''
    if (proposal === 'merge') {
      const readiness = s.mergeReadiness('merge')
      if (!readiness.ready) {
        console.error(`review declaration refused: ${readiness.reason}`)
        process.exitCode = 1
        return
      }
      const result = await (await import('./review-acceptance.js')).runReviewAcceptance({
        onProgress: (line) => console.error(`[review acceptance] ${line}`),
      })
      acceptance = result.configured ? result.report : ''
      if (!result.ok) {
        console.error(acceptance)
        console.error('review declaration refused: fix the attributable failures, or use `spex session ask --note <finding>` to hand them upward')
        process.exitCode = 1
        return
      }
    }
    let closeNote = proposal === 'close' ? CLOSE_CLEANUP : ''
    if (proposal === 'close') {
      // The closeout nudge is advisory: a declaration must land even if the local issue store fails.
      try { closeNote += (await import('./localIssues.js')).closeoutNudge(sess ?? s.ownSessionId()) }
      catch (e) { console.error(`issue closeout check failed (declaration unaffected): ${e instanceof Error ? e.message : e}`) }
    }
    const recordedNote = acceptance ? [note?.trim(), acceptance].filter(Boolean).join('\n\n') : note
    const done = mark(() => s.markDone(proposal, sess, recordedNote))
    console.log(done.ok ? `done (${proposal})${DECLARED}${noteEcho(recordedNote)}${closeNote}${acceptance ? `\n\n${acceptance}` : ''}` : done.reason ?? noRecord())
    return
  }

  const { s, sess, mark, noRecord, noteEcho } = await sessionStateKit(sessionId)
  if (verb === 'park') {
    // sugar: the agent is waiting on a background task; it will self-resume (NOT idle/awaiting)
    const parked = mark(() => s.markState('parked', { note, sessionId: sess }))
    console.log(parked.ok ? `parked${DECLARED}${noteEcho(note)}` : parked.reason ?? noRecord())
    return
  }

  // The agent deliberately pauses for a human response. This is authored state, not an active-only inference.
  const asked = mark(() => s.markState('asking', { note, sessionId: sess }))
  console.log(asked.ok ? `asking${DECLARED}${noteEcho(note)}` : asked.reason ?? noRecord())
}
