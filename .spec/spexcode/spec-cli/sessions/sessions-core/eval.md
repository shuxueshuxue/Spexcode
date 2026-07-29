---
scenarios:
  - name: slug-own-identity
    tags: [cli]
    description: >
      Run the real slug/title derivation newSession uses (sessions.ts) over three launch prompts:
      one that @-mentions another session's id in otherwise-CJK prose
      (`清理一下 @ce5362f3-ceb4-4f77-988f-197df214b15d`), one that is pure CJK (`清理一下`), and a
      mixed CJK/ASCII prompt carrying a session mention. Read the slug/branch each would get.
    expected: >
      No derived slug/branch ever contains a mentioned session id or any UUID-shaped token — a
      session can never wear another session's identity on its branch/worktree (the collision that
      lets a cleanup worker match its own worktree). CJK words survive into a meaningful unicode
      slug instead of being dropped; a prompt that is nothing but a mention still yields the
      non-empty unique `session-<shortid>` fallback.
    test: spec-cli/src/sessionSlug.test.ts
  - name: record-note-round-trip
    tags: [backend-api, cli]
    description: >
      In an isolated real project served by a real backend with the no-model fake harness, create a session
      through `POST /api/sessions`, then drive every note-carrying entry with ONE note containing a double
      quote, a backslash, a real newline, and non-ASCII text: the typed proposal verb
      (`spex session done --propose merge --note …`), the hot-path `PreToolUse` hook firing over that record
      through the real dispatcher, an `AskUserQuestion` payload whose question IS that text, and the typed
      `spex session ask --note …`. After each, read the record file, `GET /api/sessions/:id`, and a fresh
      `spex session ls --json` process.
    expected: |
      The record stays parseable JSON at every step and every surface returns the note byte-for-byte —
      quote, backslash, newline, and non-ASCII intact. No entry may write the record by assembling JSON in
      shell or by substituting into an existing value: the hook's own state change goes through the same
      structured writer the CLI uses, so a note the CLI wrote correctly can never be damaged by the next
      tool call, and the session is never reported missing while it is alive.
    code: spec-cli/src/sessions.ts
    test: spec-cli/src/session-record-integrity.test.ts
  - name: corrupt-record-is-diagnosable
    tags: [cli]
    description: >
      Plant an unparseable `session.json` in a real store (the shape the old shell substitution produced) and
      read it through the product: the session list, the per-session read, a declaration writer, and the
      lifecycle hooks' writers. Then close it.
    expected: |
      The row NEVER silently vanishes and is never reported as a plain missing session: it surfaces as a
      distinct corrupt state naming the record path and the parse error. No writer repairs it into a valid
      empty record — every writer refuses loudly instead, so a hook can neither revive nor blank it. `close`
      still works on it, and it preserves the original bytes as evidence outside the swept session dir.
    code: spec-cli/src/sessions.ts
    test: spec-cli/src/session-record-integrity.test.ts
  - name: corrupt-record-exact-proof-quarantine
    tags: [backend-api, cli, frontend-e2e]
    description: >
      Plant the incident-shaped unreadable governed record in a real served store. First attempt quarantine while
      one claimed control is live or unproven. Then remove the exact agent, tmux session, worktree, branch, and
      shared-thread reference (or supply one idle, uniquely unowned native thread), submit the same explicit
      adapter/thread/tmux/worktree/branch witness through the CLI, and observe the HTTP API plus the real dashboard.
      Finally restore the bundle.
    expected: >
      Every live, ambiguous, malformed, active, descendant-bearing, changed-generation, or unknown control is a
      loud refusal that leaves the active record byte-identical and sends no signal. A verified absence witness
      moves only the opaque `session.json` into an auditable bundle containing its exact bytes and observed proof;
      the row vanishes from the active CLI/API/dashboard and the real resource report becomes available without
      inventing lifecycle. Restore atomically returns the exact unreadable bytes and row, without recreating or
      signaling runtime resources. An idle native thread may be archived only after the adapter proves it is exact,
      unowned, and descendant-free, and its post-mutation census proves it unloaded.
    code: spec-cli/src/sessions.ts
    test: spec-cli/src/session-record-integrity.test.ts
  - name: retired-session-never-revives
    tags: [cli]
    description: >
      Take a governed record whose work already merged and whose worktree AND branch are both gone (the
      manual-retirement end state), then push every revival path at it: the lifecycle hooks' `active`/`idle`
      writers, a typed declaration, and `resume`.
    expected: |
      The session reads as retired on the list, and every revival path refuses with that reason: it never
      returns to `active`/`idle`, no launch script is regenerated for it, and no resume launch runs. `close`
      remains available to retire the record itself.
    code: spec-cli/src/sessions.ts
    test: spec-cli/src/session-record-integrity.test.ts
---

# sessions-core — measurement

YATU: derive through the exported seam `newSession` actually calls (`titleFromPrompt` + `slugify`
in `sessions.ts`), not a re-derivation — the unit test in `sessionSlug.test.ts` drives exactly
those exports and is the runnable form of the scenario; file its transcript as `--result`.

The record-integrity scenarios are measured through the running product, never by reasoning about the
writer: a real backend, the real CLI declaration verbs, and the real hook dispatcher over a real store.
The fake harness ([[fake-harness-fixture]]) is what makes that reachable with no model and no network.
