---
scenarios:
  - name: public-create-authority-routes-on-instance-identity
    tags: [backend-api, cli]
    code: spec-cli/src/sessions.ts
    description: >
      In an isolated Git project, run the real `spex session new --api` command against controllable HTTP
      targets. Make `/api/instance` fast while `/api/settings` never answers, then make instance itself slow,
      reset its accepted connection, and inject a DNS failure; use linked and configured-main roots for implicit
      match and mismatch, and repeat the mismatch via explicit `--api`. Return HTTP errors from instance, point
      at a just-closed listener, and start with a large fake session store. Count health, instance, settings,
      and creation endpoint calls and inspect the local store, branch, worktree, and tmux trace.
    expected: |
      A fast instance response routes exactly one keyed create POST to that backend even while settings would
      never answer; settings receives zero authority traffic and no local record, branch, worktree, or tmux
      artifact is created. A slow instance, reset, or DNS failure is indeterminate with no POST or fallback and
      the same zero-artifact result. Implicit routing accepts linked and configured-main equivalence, refuses a
      mismatched canonical main before POST, and explicit `--api` skips that project comparison while still
      using instance authority. An explicit target normally owns its POST; only the exact closed-listener
      ECONNREFUSED path is the legacy fallback exception. Any HTTP instance response owns the target and
      receives the one POST. A 550ms endpoint-record health read followed by a 1200ms instance response
      succeeds, proving their walls are independent. A large fake record store does not cause settings or
      layout work on the authority path.
    test: spec-cli/src/session-create-cli.test.ts
  - name: session-create-materializes-once
    tags: [backend-api, cli]
    code: spec-cli/src/sessions.ts
    description: >
      In an isolated real Git project with SpexCode's post-checkout hook installed, create a session through
      the real backend API. Record hook invocations and the child environment at `git worktree add`; also
      create an ordinary linked worktree without the session-creation marker.
    expected: >
      The session-created worktree reaches its post-seed explicit materialize exactly once under the creation
      transaction: `git worktree add` carries the scoped defer marker and its post-checkout hook performs no
      competing refresh. An ordinary linked worktree carries no marker and still invokes the normal refresh.
      Thus local state is present before the sole creation render without globally disabling Git hooks.
    test: spec-cli/src/session-create-transaction.test.ts
  - name: create-pins-an-explicit-base
    tags: [backend-api]
    code: spec-cli/src/sessions.ts
    description: >
      Against the real backend in an isolated Git project, read the source-of-truth branch head, advance that
      branch past it with another commit, then `POST /api/sessions` with `base` naming the earlier commit.
      Read the created worktree's `HEAD` and its durable record. Repeat with a `base` that names no commit and
      compare every owned resource — branches, worktrees, session stores, private candidate receipts — before
      and after.
    expected: >
      The pinned create publishes normally and its worktree forks from the named commit, not from the drifted
      branch head, and the durable record carries the pin so a later reader can tell a pinned run from an
      unpinned one. A `base` that names no commit is refused with a 400 in `target-resolution`, before any Git
      mutation or candidate receipt exists, leaving every owned resource byte-identical.
    test: spec-cli/src/session-create-transaction.test.ts
  - name: pane-snapshot-survives-the-installed-tmux
    tags: [backend-api]
    code:
      - spec-cli/src/sessions.ts#TMUX_PANE_SEPARATOR
      - spec-cli/src/sessions.ts#TMUX_PANE_FORMAT
      - spec-cli/src/sessions.ts#parseLivePanes
      - spec-cli/src/sessions.ts#liveSnapshot
    description: >
      Start a real tmux server with one session of a known name, ask it for `list-panes -a` using the EXACT
      format the liveness snapshot sends, and feed that raw output to the pane parser. Also read the format
      itself for control characters.
    expected: >
      The parser recovers that session's name as its own key carrying its pane pid, and the format carries no
      control character. tmux 3.5+ rewrites a control separator to `_` (measured on 3.6a) while 3.4 prints a
      real `0x1f` as the printable escape `\037` — so a control separator makes every pane row unparseable on a
      newer tmux, the window map holds one junk key per line, and every session reads window-less: alive ones
      collapse to `unknown` and the rest to a false `offline`.
    test: spec-cli/src/sessions-hot.test.ts
  - name: a-board-row-carries-only-the-prompt-preview
    tags: [backend-api]
    code:
      - spec-cli/src/sessions.ts#oneLinePreview
      - spec-cli/src/sessions.ts#toSession
      - spec-cli/src/sessions.ts#boardRow
      - spec-cli/src/sessions.ts#listSessions
      - spec-cli/src/sessions.ts#sessionPrompt
    description: >
      Against a real backend serving a real board whose sessions were launched with long asks, read
      `GET /api/sessions` and weigh its body: total bytes, and the share spent on each row's `prompt` versus
      its `promptPreview`. Then read `GET /api/sessions/:id` for the row with the longest ask.
    expected: >
      The list body is proportional to the NUMBER of sessions, not to the total length of their launch
      prompts: a row carries the ask only as its one-line preview, so a single long ask cannot dominate the
      board. The id-addressed detail still returns that ask in full, because it reads the stored prompt
      itself rather than inheriting the row's field. The failure this locks: shipping the full text in every
      row made 98.8% of a 2218 KB board body prompt text (27 KB of actual board data, worst single row
      246 KB) and pinned those same bytes in the last-known-row cache for the life of the process — while the
      detail route, the only full-text reader, never depended on them.
  - name: a-dead-leaf-never-wedges-a-session
    tags: [backend-api, cli]
    code: spec-cli/src/sessions.ts
    description: >
      Take a governed session whose recorded leaf pid is DEAD — the state a launcher that exits before
      readiness leaves behind — and drive the real `spex session stop` and `spex session close` against a
      backend running this code. Then confirm the opposite case still refuses: a leaf that is ALIVE but whose
      start identity cannot be matched must not be signalled.
    expected: |
      A dead recorded pid is not an obstacle to retiring the session: there is nothing to signal and nothing a
      signal could hit by mistake, so teardown proceeds record-only and `close` removes the row, worktree and
      branch. The live-but-unprovable leaf still refuses loudly, naming that it is alive and will not prove its
      start identity — signalling it could kill whatever now wears that pid. The failure this locks: both cases
      answered with ONE refusal, which left a session that could be neither launched nor closed, with
      `quarantine` inapplicable because the record parses fine. Refusal text must not say "is not alive or has
      no start identity", since that sentence is the conflation itself.
  - name: prompt-invariant-covers-every-delivery
    tags: [backend-api, cli]
    code:
      - spec-cli/src/sessions.ts#composeSessionPrompt
      - spec-cli/src/sessions.ts#optionSafe
    description: >
      The option-shaped-prompt guarantee is made at composeSessionPrompt, which serves LAUNCH and every
      SEND — so measure the send half, not only the launch half. In an isolated real project through a real
      backend running this code, launch a session with an ordinary prompt, wait until it is genuinely idle
      and listening, then `spex session send` it a message whose FIRST CHARACTER is `-`
      (`--force-rebuild failed with 413 …`). Do it for an interactive harness (delivery types into the pane)
      and for a headless one whose controller passes the turn text as a child process ARGV parameter
      (pi-headless), which is the path with no escape of its own.
    expected: |
      The message reaches the agent and the agent acts on it, on both routes. The headless controller may
      pass turn text straight into argv without any separator or stdin trick of its own, because the text it
      is handed can no longer be read as an option — that is what makes one invariant able to replace a
      per-adapter escape. The human's words survive after at most one leading space, visible in the pane
      exactly as delivered. A send is NOT proven by the CLI printing `sent`: delivery to an agent that is
      not yet listening (still on a first-run trust gate) reports sent and never reaches the turn, so the
      reading must show the agent's own response to the message's content.
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

The authority-routing scenario drives a fresh CLI process against controlled HTTP endpoints rather than calling
the in-process helper. Its result transcript is the evidence: endpoint counters prove the selected live backend
received one instance request and one keyed creation request, with zero settings traffic, while isolated
Git/store inspection proves no local fallback or duplicate creation happened.
