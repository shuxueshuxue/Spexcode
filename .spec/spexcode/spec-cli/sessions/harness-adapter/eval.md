---
scenarios:
  - name: headless-explicit-stop-resume-liveness
    tags: [backend-api, cli]
    code:
      - spec-cli/src/harness.ts#recordOnline
      - spec-cli/src/harness.ts#claudeHeadlessHarness
      - spec-cli/src/harness.ts#codexHeadlessHarness
      - spec-cli/src/harness.ts#piHeadlessHarness
      - spec-cli/src/harness.ts#opencodeHeadlessHarness
      - spec-cli/src/sessions.ts
    description: >-
      Through real governed sessions, repeat the same loop for every registered headless launcher: let the
      first turn settle with a declaration note, POST stop, verify the tmux home/runtime is gone, sample both
      `/api/graph` and `spex session ls`, then POST resume and read the same timeline again.
    expected: >-
      A sleeping non-stopped conversation remains online between turns. Explicit stop preserves lifecycle,
      worktree, native conversation, and timeline but changes liveness to offline within seconds even if the
      ordinary process probe is unavailable; CLI and graph agree and expose relaunch. Resume clears the stop
      marker, returns the same conversation online, and preserves its pre-stop declaration note. No turn-in-flight
      state or harness-specific product branch participates.
  - name: foreign-teardown-cannot-strand-a-live-agent
    tags: [backend-api, cli]
    code:
      - spec-cli/src/harness.ts#unlinkSocks
      - spec-cli/src/harness.ts#listenerAt
      - spec-cli/src/harness.ts#PROVEN_DEAD
      - spec-cli/src/harness.ts#rendezvousListening
      - spec-cli/src/harness.ts#stampRvSock
      - spec-cli/src/sessions.ts
    description: >-
      A session's rendezvous socket is keyed by session id ALONE, so it is the one per-session resource not
      scoped by the store (SPEXCODE_HOME) or the tmux server (SPEXCODE_TMUX). Stand a REAL agent daemon on
      that path, then drive a second, fully isolated backend — its own home and tmux server, holding a record
      with the SAME id — through the real close route, and afterwards read the first agent's transport: is its
      socket path still there, does a connect still reach it? Then ask the isolated board how it reads a
      session whose socket is unreachable while its registered agent pid is still alive.
    expected: >-
      The isolated close completes in its own world and removes nothing of the live agent's: the socket path
      survives and still answers a connect, because a teardown may only unlink a transport it PROVED dead. An
      ordinary teardown, whose agent really is gone, still leaves zero socket residue. And a session whose
      socket is unreachable while its agent process still answers reads `unknown`, never `offline` — death is
      unproven, so the relaunch guard stays armed instead of inviting a human to kill a working agent.
  - name: same-id-in-two-worlds-never-shares-a-transport
    tags: [backend-api, cli]
    code:
      - spec-cli/src/harness.ts#rvSock
      - spec-cli/src/harness.ts#scopedRvSock
      - spec-cli/src/harness.ts#legacyRvSock
      - spec-cli/src/harness.ts#rvStamp
      - spec-cli/src/harness.ts#stampRvSock
      - spec-cli/src/harness.ts#unlinkSocks
    description: >-
      Two isolated backends on one box, each with its own SPEXCODE_HOME and SPEXCODE_TMUX. World A launches a
      REAL governed session through POST /api/sessions; world B holds a PLANTED record carrying the SAME
      session id — the shape a fixture, a migration, or a record copied for diagnosis produces — and closes it
      through the real route. Read what world A's agent is actually bound to, what world A recorded, what a
      world that never launched it would derive, and whether A survives B.
    expected: >-
      World A records the transport it handed its agent (a launch-time fact beside the record, like the pid),
      the agent is bound to exactly that path, and the path is scoped to A's runtime rather than derived from
      the session id alone — so nothing sits where a foreign world would look. World B's close touches
      nothing of A's: A keeps answering and its own board still reads it online. World A's own close still
      sweeps its socket, leaving zero residue.
  - name: headless-turn-exit-error
    tags: [backend-api, cli]
    code:
      - spec-cli/src/harness.ts#reportHeadlessTurnExit
      - spec-cli/src/harness.ts#headlessTurnFailureShell
    description: >-
      Through real `spex session new` launches, give each registered headless adapter a controlled harness
      command whose turn process exits non-zero without calling a lifecycle declaration. Read the session only
      through the public `spex session show --json` surface. Also run control turns that exit zero and turns
      whose record is already declared before process teardown.
    expected: >-
      Each non-zero undeclared turn leaves the durable session visible but changes its lifecycle/status from
      active/working to error within a bounded wall, with a note naming the harness and exit code or signal.
      Liveness remains online only when the adapter can still accept a subsequent delivery. Zero exits do not
      manufacture an error, and a declaration that lands before teardown is never overwritten.
  - name: codex-turn-completed-failure
    tags: [backend-api, cli]
    code:
      - spec-cli/src/harness.ts#codexTurnFailureObserver
      - spec-cli/src/sessions.ts#superviseTurnFailures
      - spec-cli/src/sessions.ts#markTurnFailure
    description: >-
      Through a real governed interactive Codex session and its project app-server, force one model turn to
      finish with the native `turn/completed` status `failed` without reaching Codex's Stop hook. Read the
      session only through `spex session show --json`, and preserve the app-server completion payload beside
      the reading. At the native protocol boundary, repeat with completed and interrupted controls; at the
      session writer boundary, race failure against an already-landed declaration.
    expected: >-
      The native failed completion changes an undeclared active session to lifecycle/status `error` within a
      bounded wall, with a note naming Codex and the structured failure message. The recorded failure time is
      the native turn's `completedAt`, not the observer's later discovery time. Completed and interrupted turns
      manufacture no error, and a declaration that lands before completion remains authoritative. Detection
      survives a backend restart by resubscribing to every live governed Codex thread: a native `systemError`
      thread status proves the missed failure and its latest turn supplies the original completion time before
      later live completions arrive. No Codex StopFailure hook is invented.
  - name: nested-subagent-hooks-do-not-clobber-parent-record
    tags: [backend-api]
    code: spec-cli/hooks/harness.sh
    description: >-
      A governed claude session (record P, declared `parked`) spawns nested subagents (Task tool), which
      inherit SPEXCODE_SESSION_ID=P in their environment but carry their OWN session_id in every hook
      payload. Simulate the child's hook exactly: a PreToolUse payload with session_id=S-child piped to
      dispatch.sh with SPEXCODE_SESSION_ID=P exported. Also simulate the two legit env uses: the parent's
      own payload (session_id=P) and a payload with NO session_id at all. Read record P after each.
    expected: >-
      The child's hook resolves to ITS payload id (S-child, non-governed, no record → the board-lifecycle
      hooks no-op) and record P stays `parked` with its note intact — a parent's declared state survives
      its own subagents' activity (the measured failure: every park was clobbered back to `active` within
      seconds by inherited-env mark-active, so the session read `working` on the board forever). The
      parent's own payload still writes P, and a payload-less event still falls back to the env id — the
      payload wins only when present, mirroring the codex alias rule one case below.
  - name: codex-apply-patch-triggers-spec-hooks
    tags: [backend-api]
    description: >-
      Through a REAL codex session (live exec/TUI, not a synthetic payload), first EDIT a governed code file
      via apply_patch and then READ it via a shell command. Codex sends the edit as its OWN tool
      `tool_name:"apply_patch"` whose `tool_input.command` is the bare patch envelope (`*** Update File: <path>`)
      — no `file_path`, no literal `apply_patch` token. Observe the global session dir's spec-first sentinel and
      spec-of-file ledger.
    expected: >-
      The adapter's shell mirror maps the apply_patch envelope through `mutate`, so spec-of-file records the
      edited path, but the edit leaves spec-first's sentinel absent because that gate uses the separate `read`
      matcher. The later Bash read resolves the same path, finds its real governor, and spec-first blocks once;
      the retry passes. This is identical to Claude's Edit/Read split from one semantic matcher interface. The
      failure this locks: if event-wide PreToolUse delivery itself consumes the gate, an edit or unrelated tool
      silently mutes the later governed read; if apply_patch is not mapped, spec-of-file is inert on Codex.
      SECOND, ATTRIBUTION: because design C's hooks fire from the SHARED
      app-server (whose env may carry another session's `SPEXCODE_SESSION_ID`), `hp_session_id` must start from
      the codex payload THREAD id, so the sentinel/ledger AND mark-active's re-flip reach the SpexCode-id
      GOVERNED record resolved via the thread-id→`harness_session_id` alias (`hp_store_dir`), NOT the stale env
      session and NOT a phantom `<runtime>/sessions/<thread-id>` dir.
      The failure this locks: without the alias the writes silently target a non-existent dir and the board never
      sees the codex session flip to `active` / `asking`. The agent's explicit `spex session done/park/ask` calls
      run in the SAME shared app-server process (NOT a per-session TUI pane), so they too inherit the baked FIRST
      session's `SPEXCODE_SESSION_ID` and — before the fix — cross-contaminated, every codex session's declaration
      landing on the first; they attribute per-thread ONLY because `envSessionId` resolves codex's injected
      `CODEX_THREAD_ID` (the acting thread) through the same `harness_session_id` alias BEFORE the contaminated
      `SPEXCODE_SESSION_ID` — so both the hook writes and the interactive declarations hide this until measured
      through a real codex round-trip, not a synthetic Bash-only payload.
    code: spec-cli/hooks/harness.sh
  - name: codex-delivery-steers-midturn-and-resumes
    tags: [backend-api]
    description: >-
      Through a REAL codex session on the project app-server, exercise the adapter's deliver + resume. (a) While
      the agent is MID-TURN (an `inProgress` turn — a long-running tool call), `spex session send` a message and
      watch the codex pane: the model must react WITHIN the same running turn, not after it stops. (b) While the
      agent is IDLE, send again — it must still land. (c) Kill the tmux window and `reopen`: the relaunched TUI
      must show the SAME prior conversation (unchanged captured thread id), not a blank new thread.
    expected: >-
      deliver reads the live thread (`thread/read{includeTurns}`) and chooses `turn/steer` when a turn is
      `inProgress` — the injected message lands mid-turn (the agent acknowledges it while its background command
      is still running, reporting a step SHORT of the final one) and the turn continues — and `turn/start` when
      idle (the message still lands). The failure this locks: always `turn/start` QUEUES a busy agent's message
      until the current turn ends, so a human's mid-turn steer is silently delayed instead of injected "right
      after the running tool call completes". `reopen` relaunches `codex resume <captured-thread-id>` so the
      prior conversation is present and `harness_session_id` is unchanged — the SAME conversation, matching
      claude's `--resume`, not a fresh thread.
    code:
      - spec-cli/src/harness.ts#sendCodexAppServerTurn
      - spec-cli/src/harness.ts#deliverViaCodexAppServer
      - spec-cli/src/harness.ts#activeTurnIdFromThread
      - spec-cli/src/harness.ts#codexInjectMessage
      - spec-cli/src/harness.ts#codexHandshakeMessages
      - spec-cli/src/harness.ts#codexHarness
  - name: claude-delivery-survives-probe-race
    tags: [backend-api]
    description: >-
      Against a REAL claude session on its rendezvous socket (a live reclaude with CLAUDE_BG_BACKEND=daemon,
      driven busy mid-turn so its event loop lags), run a liveness-probe hammer (the rendezvousListening
      pattern: connect + immediate close, every ~20ms) and, while it runs, deliver N prompts through the real
      product surface (`spex session send` → POST /input → sendText → the claude adapter's deliver). Then read
      the claude transcript's queue-operation log and count which prompts actually entered claude's input
      pipeline.
    expected: >-
      Every prompt that `sendText` confirms (`sent`) is present in the transcript (enqueued and eventually
      submitted); a delivery the daemon never parsed is reported as a loud failure or retried until parsed —
      never a false success. The failure this locks: claude's rendezvous daemon keeps ONE connection and
      destroys the previous socket on every new connect, discarding any received-but-unparsed line — so a
      liveness probe landing in the write→parse window silently killed the prompt while the optimistic
      write-flush confirmation reported ok (measured: 2/10 real sends lost under a 20ms hammer, 40/40 in the
      tight-race isolation; the field incident was session 430b487e's two dashboard messages recorded `sent`
      with no trace in the claude transcript). The fix's proof is the same rig reading 0 lost: the reply and a
      repaint probe go out in ONE atomic chunk (parsed in one synchronous line-loop, so a kick can only lose
      both), `repaint-done` on the delivery connection = parsed-proof, a close before it = proven loss →
      reconnect and resend, wall expiry with the connection still open = optimistic ok (busy ≠ lost).
    code:
      - spec-cli/src/harness.ts#replyViaSocket
      - spec-cli/src/harness.ts#deliverViaRendezvous
      - spec-cli/src/harness.ts#DELIVER_ATTEMPTS
  - name: claude-delivery-survives-sessions-panel
    tags: [backend-api]
    description: >-
      With a REAL claude session IDLE and its TUI focus moved to the sessions/agents panel (← from the
      composer — the "← for agents" screen), deliver a prompt through the real send surface. Compare against
      the same send with the TUI on the normal composer. Then return the TUI to the composer and let the
      session reach a turn boundary.
    expected: >-
      Both sends SUCCEED and both messages are in the target's log: delivery is the append ([[dispatch]]),
      and the pane predicate no longer decides it. What the predicate still buys is that the panel-state
      send does not waste a kick it knows will be swallowed — so the composer-state message arrives in the
      current turn, while the panel-state one is simply left unread and is delivered by the turn-boundary
      reader once the TUI is back. The failure this locks is now recoverable rather than merely visible: a
      reply injected while the panel has focus is parsed and enqueued by the daemon (transcript shows
      `enqueue`) but NEVER dequeued — no turn, no pane trace, nothing for any transport-layer confirmation
      to see. Before, the only honest answer was to refuse the send; now the message survives claude's bug
      instead of depending on a human resending it.
    code:
      - spec-cli/src/harness.ts#claudeHarness
  - name: codex-liveness-reflects-live-tui-not-sock
    tags: [backend-api]
    description: >-
      Through a REAL codex launch, read liveness for the three real shapes. (a) HEALTHY: a codex session whose
      TUI is up and rendering — note its pane's `pane_current_command` is `bash` (the launch wrapper; the codex
      processes are the pane pid's DESCENDANTS: bash → node (the codex CLI) → the vendored codex binary). (b)
      FAILED: the macmini shape — the shared per-project app-server socket is bound but THIS session's visible
      `codex --remote … resume <tid>` TUI FAILED and, after its bounded retries, the launch pane dropped back to
      an idle shell — nothing below the pane pid. (c) BOOTING: a just-launched pane inside the boot-grace
      window. Read the board / `spex ls` for each.
    expected: >-
      HEALTHY reads **online**, because codex liveness keys on a codex-ish process (basename codex*/node*) being
      live in the pane pid's DESCENDANT tree — NOT on the pane's foreground command name, which is `bash` for
      the TUI's whole life. FAILED reads **offline** (NOT online/working) despite the still-bound shared sock.
      BOOTING reads **starting**, not offline. The TWO failures this locks, one per wrong signal: (1)
      sock-presence read the dead launch as online/working (the SHARED sock survives a failed `--remote
      resume`), so the supervisor treated a never-started worker as live; (2) the foreground-name probe
      (online iff `pane_current_command` == codex) FALSE-read every HEALTHY codex as offline — field-confirmed:
      a rendering TUI's foreground is the bash wrapper — so the board showed working codex sessions as dead and
      a supervisor could wrongly reopen/kill them. Both are measurable only through a real launch (a synthetic
      pane hides the wrapper-shell tree shape).
    code:
      - spec-cli/src/harness.ts#paneTreeRuns
      - spec-cli/src/harness.ts#paneTreeRunsCodex
      - spec-cli/src/harness.ts#CODEXISH
      - spec-cli/src/harness.ts#procSnapshot
  - name: codex-app-server-sock-binds-on-hardened-tmp
    tags: [backend-api]
    description: >-
      On a normally-hardened Linux host (`fs.protected_regular=2`, root-owned sticky `/tmp` — stock Ubuntu), with
      NO `SPEXCODE_CODEX_SOCKET_DIR` override set: derive the app-server socket path exactly as the launch path
      does (`codexAppServerSock`), then run the launch script's own spawn — `codex app-server --listen
      unix://<sock>` — and the client's `connect()` against it. Control: the SAME codex binding the SAME filename
      inside an owned 0700 subdirectory.
    expected: >-
      The default-derived socket binds and accepts a connect out of the box — no env knob required. The failure
      this locks (github#30): the derivation defaulted to BARE `tmpdir()`, and codex (≥0.137 field-confirmed,
      0.142.5 reported) refuses to bind a unix socket directly in the shared sticky `/tmp` — `Error: Operation
      not permitted (os error 1)` — so the server never comes up, the client's connect gets ENOENT, and launch.sh
      burns all its retries: EVERY codex-launcher session on a fresh hardened install dies with `codex app-server
      connection failed: connect ENOENT /tmp/spexcode-cx-<hash>.sock` while claude launchers work — yet the same
      codex binds fine in any OWNED subdirectory (the control), so the fix belongs to the path derivation, not
      the host.
    code:
      - spec-cli/src/harness.ts#codexAppServerSock
  - name: session-stamp-unmatched-thread-id-is-clean-noop
    tags: [backend-api]
    code: spec-cli/templates/hooks/prepare-commit-msg
    description: >-
      In an initialized ordinary repo with the session-stamp hook installed, whose environment inherits a
      NONEMPTY foreign session id (CODEX_THREAD_ID / SPEXCODE_SESSION_ID / CLAUDE_CODE_SESSION_ID) that
      resolves to no record in that repo's project store (both store shapes: no sessions dir at all, and a
      store whose records carry different ids), run `git commit` — including `--no-verify`, which does NOT
      skip prepare-commit-msg. Controls on the same rig: a claim that DOES resolve and passes its check, and
      a message already carrying a Session: trailer.
    expected: >-
      The unresolvable claim is a clean NO-OP: the commit succeeds and its message carries NO Session trailer
      — not an empty one, not the inherited foreign id. The resolving control stamps that record's id, the
      pre-trailered message is left alone, and a genuine hook error still fails loud. The failure this locks:
      the store lookup ran bare under `set -euo pipefail`, so a no-match aborted the hook before its intended
      no-op exit — EVERY `git commit` in ANY repo with the hook installed exited 1 with no message whenever
      the shell inherited a foreign codex thread id (e.g. any command a codex session spawns in an unrelated
      repo), a silent total commit outage.
  - name: session-identity-is-injected-never-inherited
    tags: [backend-api, cli]
    code: spec-cli/templates/hooks/prepare-commit-msg
    test:
      path: spec-cli/src/session-stamp.test.ts
      name: the session id the launch injected becomes the trailer, verbatim
    description: >-
      Measure the invariant at every process SpexCode creates, on the live box and through real dispatches.
      (1) A session launch: read the generated launch line — does it strip inherited session-identity
      variables before setting its own? (2) The shared codex app-server: start one through the real generated
      script from a launcher environment carrying a session's ids, and read its `/proc/<pid>/environ`.
      (3) A codex thread: create one through the real `thread/start` path and ask the agent to print its own
      shell's identity, reading the answer only from the turn's final message. (4) The whole loop: dispatch a
      REAL codex worker into a fresh `spex init` project and read the trailer on the commit it actually makes,
      plus a real claude session's commit in this repo.
    expected: >-
      A session-identity variable exists in a process only if that process belongs to that session. The launch
      strips every inherited id and sets the record id; the shared app-server carries none at all; a codex
      thread's own tool shell carries exactly the record id the backend injected for THAT thread (and its own
      CODEX_THREAD_ID), with nothing of the launcher's environment. Because of that, the commit hook reads
      SPEXCODE_SESSION_ID and stamps it — no store lookup, no per-harness ladder, no ancestry check, nothing
      derived from the current directory — and both a dispatched codex worker and a claude session land a
      trailer naming their own record. No id, no trailer, commit still exits 0 (including `--no-verify`, which
      does not skip prepare-commit-msg). The failure this locks: with the invariant missing, a shared daemon
      that outlived its session handed that id to every later thread's commit — 48 commits in this repo name a
      session that no longer exists (github#76) — and any repair downstream of the leak is a guess about which
      claim to believe.
  - name: codex-app-server-carries-no-session-identity
    tags: [backend-api, cli]
    code:
      - spec-cli/src/harness.ts#sessionIdentityEnvVars
      - spec-cli/src/harness.ts#codexLaunchCommand
      - spec-cli/src/harness.ts#codexStartThreadParams
    description: >-
      Run the REAL generated codex launch script verbatim under a launcher environment that carries a
      session's identity (SPEXCODE_SESSION_ID plus adapter session vars, as every launch.sh really does),
      pointed at a throwaway runtime dir and socket so it starts a FRESH shared app-server. Read that
      daemon's actual `/proc/<pid>/environ`. Then fire one real turn on it through `spex internal
      codex-launch` and ask the agent to report its own shell's identity variables, reading the answer ONLY
      from the turn's tool-call output and final assistant message in codex's rollout — never a grep over
      the transcript, which would match the prompt's own echo.
    expected: >-
      The daemon comes up (exit 0, socket bound) carrying NONE of the planted session-identity variables: a
      project-scoped process shared by every worktree's threads, and outliving them all, must not hold one
      session's id. The thread's own tool shell then reports exactly ONE identity — `CODEX_THREAD_ID` equal
      to the thread id `codex-launch` returned — and neither stale launcher id, proving the strip removed
      only wrong answers: the acting-thread id every hook, declaration, and alias lookup resolves from is
      injected per command by codex itself and survives. The failure this locks: daemons here ran for days
      handing a long-closed session's id to every later thread's tool shell, which is how a stranger's
      session ended up on other sessions' commits (github#76).
  - name: codex-dispatched-thread-fires-lifecycle-hooks
    tags: [backend-api]
    description: >-
      Through the REAL dashboard/app-server launch path (NOT `codex exec`, whose interactive approval flow
      AUTO-TRUSTS the cwd and hides the gap): dispatch a codex worker into a FRESH-INIT project (no skill nodes)
      and trace `dispatch.sh` across its first turn, then read session.json and the worker's commit. The worker
      runs as a BACKEND-owned thread on the shared per-project app-server with `cwd = a linked worktree`, launched
      with `--dangerously-bypass-hook-trust`.
    expected: >-
      The codex thread fires the full lifecycle through `dispatch.sh` — SessionStart, UserPromptSubmit, PreToolUse,
      PostToolUse, Stop — with NO interactive "Hooks need review" prompt; session.json advances past the launch
      state (the Stop gate flips it to `asking`/`awaiting`/`idle`); and the worker's commit carries the `Session:`
      trailer. This requires THREE codex preconditions that `--dangerously-bypass-hook-trust` does NOT provide, all
      established by materialize (bypass is read only PER-HANDLER, after layer discovery — it can neither BUILD nor
      ENABLE a layer): (a) the worktree carries a `.codex/` ANCHOR so codex builds a project layer for the worktree
      cwd (whose hooks-folder rewrites to the main-checkout shim); (b) `[projects."<mainCheckout>"] trust_level =
      "trusted"` ENABLES that layer (codex drops a disabled/untrusted layer before discovery, and the app-server
      does NOT auto-trust); (c) per-hook `trusted_hash` blocks make the hooks "reviewed", because our `codex resume`
      TUI is a PERSISTENT RESUME on which codex forces the hook-review prompt regardless of the bypass flag — an
      unhashed hook WEDGES the worker at an interactive menu. The failure this locks (the real regression): with the
      bypass sent but the anchor/trust/hashes missing, a fresh-init codex worker fires ZERO dispatch events (frozen
      session.json, no Stop gate, no Session trailer), while a STANDALONE `.codex` in the cwd — which the exec/TUI
      flow auto-trusts — still fires them, so a standalone or exec-only check passes green and the dispatched-worker
      regression hides. Provable only by dispatching a REAL worker into a fresh-init project and tracing dispatch +
      reading session.json + the commit trailer.
    code:
      - spec-cli/src/harness.ts#writeCodexTrust
      - spec-cli/src/harness.ts#codexHookHash
      - spec-cli/src/harness.ts#stripCodexTrustFor
      - spec-cli/src/harness.ts#buildShim
  - name: codex-launch-ignores-future-dated-rollout-dirs
    tags: [backend-api]
    code:
      - spec-cli/src/harness.ts#codexRolloutExists
      - spec-cli/src/harness.ts#codexSessionsDir
      - spec-cli/src/harness.ts#waitForCodexRollout
    test:
      path: spec-cli/src/harness.test.ts
      name: codexRolloutExists is immune to future-dated junk day-dirs above the real rollout
    description: >-
      Through the REAL governed Codex launch path on a running backend, temporarily seed three future-dated
      day directories under the active CODEX_HOME sessions tree so they sort above every real rollout day,
      then dispatch a Codex worker with `spex session new`. Observe the public session record, its owned
      `harness_session_id`, liveness, and visible TUI; remove the seeded directories and close the throwaway
      session after the observation.
    expected: >-
      The worker advances from starting to online with a nonempty owned Codex thread id, and the visible TUI
      attaches to that same thread. The launch never reports `persisted no rollout within 20s`: rollout
      discovery walks the date tree newest-first but exhaustively, so future-dated junk cannot mask the real
      current-day rollout. No duplicate prompt/thread retry is created, and cleanup leaves no seeded directory,
      session record, tmux window, worktree, or branch behind.
  # harness-delivery-campaign:start
  - name: delivery-combo-claude-launch-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "claude / launch / idle" }
    description: >-
      Through the real claude launcher, measure the launch first prompt path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as the interactive TUI pane containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-claude-launch-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "claude / launch / in-turn" }
    description: >-
      Through the real claude launcher, measure the launch first prompt path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      The cell is reported BLOCKED because a launch first prompt creates its turn and cannot be
      injected into a pre-existing in-progress turn. The runner invents no substitute launch or
      private transport, and the remaining launch/idle cell carries launch-path coverage.
  - name: delivery-combo-claude-dashboard-note-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "claude / dashboard-note / idle" }
    description: >-
      Through the real claude launcher, measure the dashboard note composer path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-claude-dashboard-note-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "claude / dashboard-note / in-turn" }
    description: >-
      Through the real claude launcher, measure the dashboard note composer path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-claude-cli-send-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "claude / cli-send / idle" }
    description: >-
      Through the real claude launcher, measure the CLI session send path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as the interactive TUI pane containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-claude-cli-send-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "claude / cli-send / in-turn" }
    description: >-
      Through the real claude launcher, measure the CLI session send path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as the interactive TUI pane containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-codex-launch-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "codex / launch / idle" }
    description: >-
      Through the real codex launcher, measure the launch first prompt path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as the interactive TUI pane containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-codex-launch-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "codex / launch / in-turn" }
    description: >-
      Through the real codex launcher, measure the launch first prompt path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      The cell is reported BLOCKED because a launch first prompt creates its turn and cannot be
      injected into a pre-existing in-progress turn. The runner invents no substitute launch or
      private transport, and the remaining launch/idle cell carries launch-path coverage.
  - name: delivery-combo-codex-dashboard-note-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "codex / dashboard-note / idle" }
    description: >-
      Through the real codex launcher, measure the dashboard note composer path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-codex-dashboard-note-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "codex / dashboard-note / in-turn" }
    description: >-
      Through the real codex launcher, measure the dashboard note composer path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-codex-cli-send-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "codex / cli-send / idle" }
    description: >-
      Through the real codex launcher, measure the CLI session send path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as the interactive TUI pane containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-codex-cli-send-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "codex / cli-send / in-turn" }
    description: >-
      Through the real codex launcher, measure the CLI session send path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as the interactive TUI pane containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: harness-delivery-combination-campaign
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "8 x 3 x 2 aggregate" }
    description: >-
      Run the full delivery campaign across four interactive and four headless harness forms, three prompt
      origins, and idle versus in-turn timing. Preserve one real conversation per launcher so channel
      transitions are exercised, and aggregate every cell transcript into one Markdown result table.
    expected: >-
      All 40 runnable cells pass delivery confirmation, answer visibility, liveness, and declaration checks;
      the eight launch/in-turn cells are explicitly BLOCKED as structurally inapplicable; no cell is skipped,
      silently inferred, or replaced by an internal transport.
  - name: legacy-codex-receipt-migration-unblocks-close
    tags: [backend-api, frontend-e2e]
    test:
      path: spec-cli/src/harness.test.ts
      name: Codex mutation guard promotes an exact v3 scope before target close proof
    description: >-
      In an isolated project, leave a detached Codex app-server with its exact legacy v3 scope and live socket,
      remove only its v4 receipt, and keep a close-pending governed target record whose native thread is not
      loaded. First read resources, then use the dashboard's session-row close confirmation against the real
      backend. Repeat with a malformed or mismatched v3 scope.
    expected: >-
      The read reports an unproven shared generation and creates no receipt. The close mutation promotes only an
      exact live Linux v3 PID/start/PGID/SID witness to a verified v4 receipt, proves the target has no loaded or
      active thread, and removes that target's session record, worktree, and branch without disturbing the shared
      process or any sibling. A malformed or mismatched v3 witness remains a visible 409 refusal and creates no
      receipt or teardown side effect.
  # harness-delivery-campaign:end
---
# eval.md — harness-adapter

The adapter's whole job is that the user-facing spec hooks ([[inject-spec-first]], [[inject-spec-of-file]], mark-active) behave
identically whichever harness the user runs. The load-bearing divergence is codex's **two-tool code model** — a
shell read is `tool_name:"Bash"`, while an edit is `tool_name:"apply_patch"` carrying the bare patch envelope.
The operation matcher must preserve that distinction: spec-first consumes only a governed READ, while
spec-of-file observes the mutation. This is measured YATU through a real codex edit-then-read round trip and
compared with the Claude baseline. The trust / zero-prompt-launch half of the adapter is measured by
[[harness-delivery]]'s `self-launch-zero-friction-codex`.

The adapter's OTHER user-observable behaviour is **prompt delivery**: the dashboard input must reach a live codex
session the way a human expects — injected INTO the running turn when the agent is busy (steer), not parked behind it.
That is a separate code slice (`harness.ts`'s app-server JSON-RPC), so it carries its own scenario and stales
independently of the shell-mirror payload parse. It too is measured the YATU way — a real codex session driven busy,
steered mid-turn through the real `spex session send` surface, then killed and `reopen`ed to prove the conversation
resumes — never a synthetic socket stub, which would prove only that bytes were written, not that codex acted.
