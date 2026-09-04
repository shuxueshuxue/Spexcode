// @@@ no runtime - this module opens no record and spawns nothing; it is a pure function of a session board
// and a selector string, which is why every session command can share it with no ordering constraint.
import { resolve, sep } from 'node:path'
import { envSessionId } from '@spexcode/spec-core'
import { stripRefSigil } from './mentions.js'
import type { Session } from './sessions.js'



// @@@ session selectors - the ONE matcher every session command shares (see [[session-selectors]]). A
// selector matches a session iff it is the session's full id, an id-PREFIX, its branch, or `.` for
// the caller's own launched session. This is
// the single predicate; selectSessions (MANY) and resolveSession (ONE) both call it, so id-prefix/branch
// resolution can never drift between "which sessions ls/watch/wait/graph show" and "which session
// review/merge/send/close act on".
export function matchesSelector(s: Session, q: string, own = envSessionId(), cwd = process.cwd()): boolean {
  // a selector may be a comma-separated list (the same convention as `--status a,b`): it matches iff ANY part
  // names the session, so `watch a,b` and `watch a b` are equivalent. A single name is the one-part case. This
  // is what stops a comma-joined selector from silently matching nothing — an id/branch never holds a
  // comma, so without the split `a,b` would be one literal selector that matches no session and streams in
  // silence forever. Each part sheds an optional reference sigil (stripRefSigil): `@<sel>` / `[[<sel>]]` name
  // the same session as the bare token, so the dashboard's mention grammar is tolerated in every CLI selector.
  const sessionPath = s.path ? resolve(s.path) : null
  const callerPath = resolve(cwd)
  const self = Boolean(own) && s.id === own
    || Boolean(sessionPath) && (callerPath === sessionPath || callerPath.startsWith(`${sessionPath}${sep}`))
  return q.split(',').map((p) => stripRefSigil(p.trim())).filter(Boolean)
    .some((p) => p === '.' ? self : s.id === p || s.id.startsWith(p) || s.branch === p)
}

// no selectors (or '@all') = everything. Optional status filter on top. This IS the ls/watch subscription.
export function selectSessions(all: Session[], selectors: string[], statuses?: string[], own = envSessionId(), cwd = process.cwd()): Session[] {
  let out = all
  const sel = selectors.filter((x) => x && x !== '@all')
  if (sel.length) out = out.filter((s) => sel.some((q) => matchesSelector(s, q, own, cwd)))
  if (statuses && statuses.length) out = out.filter((s) => statuses.includes(s.status))
  return out
}

// Parentage is a durable direct pointer, even when that parent was terminally closed and no longer has a row.
// The CLI's child scope must keep that fact visible rather than requiring callers to reverse-engineer prompts.
export function selectChildren(all: Session[], parent: string): Session[] {
  return all.filter((session) => session.parent === parent)
}

/** Read-time descendant closure; callers may filter terminal rows after traversing closed intermediates. */
export function selectDescendants(all: Session[], parent: string): Session[] {
  const byParent = new Map<string, Session[]>()
  for (const session of all) {
    if (!session.parent) continue
    const children = byParent.get(session.parent) ?? []
    children.push(session)
    byParent.set(session.parent, children)
  }
  const out: Session[] = []
  const seen = new Set<string>([parent])
  const visit = (id: string): void => {
    for (const child of byParent.get(id) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push(child)
      visit(child.id)
    }
  }
  visit(parent)
  return out
}

// @@@ resolveSession - resolve ONE selector to ONE session against a board: the single-target counterpart of
// selectSessions, for the control verbs (review/send/merge/close/resume/show). The backend matches
// ids EXACTLY, so a verb resolves the selector here first and then calls with the FULL id — a branch/
// prefix selector drives a verb just as it filters `ls`. The result is DISCRIMINATED so a caller can fail
// precisely: an exact full-id hit wins outright (never reported ambiguous just for prefixing a longer id);
// otherwise a lone match is `ok`, several is `ambiguous` (a prefix hitting many), none is `none`.
export type Resolved = { ok: Session } | { ambiguous: Session[] } | { none: true }
export function resolveSession(selector: string, sessions: Session[], own = envSessionId(), cwd = process.cwd()): Resolved {
  // the exact-id check sheds the optional sigil too, so `@<full-id>` keeps the exact-wins-over-prefix rule
  const exact = sessions.find((s) => s.id === stripRefSigil(selector))
  if (exact) return { ok: exact }
  const hits = sessions.filter((s) => matchesSelector(s, selector, own, cwd))
  if (hits.length === 1) return { ok: hits[0] }
  return hits.length ? { ambiguous: hits } : { none: true }
}
