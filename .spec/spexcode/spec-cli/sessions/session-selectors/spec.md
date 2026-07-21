---
title: session-selectors
status: active
hue: 280
desc: One selector grammar (id·id-prefix·node·branch·self) and one matcher, so every session command names the same sessions.
code:
  - spec-cli/src/selectors.test.ts
related:
  - spec-cli/src/sessions.ts
---

# session-selectors

## raw source

A user names a session several ways — its full id, a short id-prefix, its node, its branch, or `.` for the
session making the call — and every
session command should understand the SAME names. The bug this node removes: the list verbs (`ls` / `watch` /
`wait` / the graph) matched on all four, but the control verbs (`review` / `merge` / `send` / `close` /
`reopen` / `capture` / `prompt`) took a RAW id straight to the backend's exact-match endpoint, so a
prefix / node / branch selector worked for `ls` but NOT for `merge` — forcing callers to hand-resolve full
ids. One grammar, one matcher, no per-command matching logic anywhere.

## expanded spec

**One predicate.** `matchesSelector(session, q)` is the single rule: `q` matches a session iff it is the
session's full id, an id-PREFIX, its node, or its branch. Nothing re-derives it — both shapes below call it,
so the grammar can never drift between "which sessions does `ls` show" and "which session does `merge` act on".

**A selector may be a comma list.** `q` is split on commas and matches iff ANY part names the session — the
same `a,b` convention as `--status`, so `spex watch a,b` and `spex watch a b` are equivalent. A single name
is just the one-part case. This closes a silent failure: before, `watch a,b` was one literal selector that
matched no session at all (an id/node/branch never contains a comma), so a comma-joined watch streamed
**zero events forever** with no error — exactly the trap a `--status`-trained user falls into.

**A part sheds an optional reference sigil.** Each comma-part passes through [[mentions]]'s `stripRefSigil`
before matching, so `@<sel>` and `[[<sel>]]` name exactly the session the bare token names — the reference
grammar a user learns in the dashboard's input boxes works verbatim as a CLI selector (`spex review @graph`
≡ `spex review graph`). The single-target exact-id check strips too, so `@<full-id>` keeps the
exact-wins-over-prefix rule. Because the strip lives in the ONE matcher, every selector-taking verb
tolerates the sigil at once, and tolerance never widens what matches.

**`.` names the caller's own governed session.** The one predicate uses two facts the subsystem already owns:
the launched worker's exact own-session id, and the durable session record whose worktree `path` contains the
caller's cwd. Either exact match identifies the same row, so a harness with a shared resident process cannot
break self-reference by contaminating its session env, and the MANY list/watch shape cannot disagree with the
ONE control-verb shape. A human shell inside that session worktree gets the same natural meaning. Outside any
known session worktree, with no matching own id, `.` fails loudly instead of selecting an arbitrary board row.

**Two shapes over the one predicate.** `selectSessions` is the MANY shape — the list / stream / graph filter
([[session-edges]], `spex ls`): empty selectors (or `@all`) means everything, with an optional status filter on top.
`resolveSession` is the ONE shape — the single-target lookup the control verbs need. Its result is
DISCRIMINATED so a caller fails precisely: `ok` (one match), `ambiguous` (a prefix or node hitting several —
carried so the user can be told which), `none` (nothing). An exact full-id match wins outright, so a full id
is never reported ambiguous merely because it prefixes a longer one.

**Every control verb routes through it.** Because the backend's `/api/sessions/:id` matches the id EXACTLY,
each control verb resolves the selector FIRST — against the live board, via [[remote-client]]'s
`resolveClientSession` — and then calls with the resolved FULL id. The CLI turns a non-`ok` result into a
precise error and a non-zero exit (`none` → no such session; `ambiguous` → the candidates). So the read verbs
and the control verbs share one selector grammar, and no command carries its own matching.

The **local state producers** (`session done` / `park` / `ask`, and `review`-as-propose) are deliberately NOT
here: they never NAME another session at all. Each resolves the agent's OWN session by id — the `--session
<id>` the hooks pass from the payload, else the harness env var (`ownSessionId`) — and writes (or, for
`review`-as-propose, reads by exact id) that session's GLOBAL record directly ([[state]]), so it must work
with no backend up. There is no selector to match here, and never a lookup against the backend board.
