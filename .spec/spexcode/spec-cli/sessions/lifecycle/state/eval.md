---
scenarios:
  - name: session-verb-chain-v030
    tags: [cli, backend-api]
    description: >-
      The v0.3.0 session-verb surface, end to end through the real CLI against a throwaway backend with a
      real dispatched worker: `session new` → poll `show --json` to online → `show` (record detail:
      status·node·branch·launcher·prompt) → `show --json` (prompt round-trips byte-identical) →
      `show --capture` (live pane) → `show` on an unknown id → `send <SEL> "<text>"` → the last-resort
      `send --keys` face (type chars into the live TUI, prove them on the captured pane, erase them; an
      invalid token batch fails) → every removed spelling (`exit`/`reopen`/`capture`/`prompt`/`rawkey`/
      `state`) → `stop` (worktree kept, pane gone) → `resume` (same conversation relaunches) → `resume`
      again on the now-live agent → `close`.
    expected: >-
      Every step lands with its contract exit code: show 0 / unknown 2; --capture empty-ok 0, unknown 2,
      offline 1; send text 0; send --keys 0 with the typed chars visible on the pane, 1 when nothing
      delivers; each removed spelling exits 2 with a one-line signpost naming the new spelling and NO side
      effect (worker stays online); stop exits 0 and the session reads liveness offline with its worktree
      intact; resume exits 0 and the worker comes back online; resume on the live agent REFUSES loud
      (exit 2, the resume guard); close exits 0 and a following show exits 2. The dashboard sessions page
      tracks the arc live: the worker terminal while online, the relaunch panel while stopped.
    code: [spec-cli/src/cli.ts, spec-cli/src/client.ts, spec-cli/src/index.ts, spec-cli/src/sessions.ts]
  - name: worktree-has-zero-session
    tags: [backend-api]
    description: >-
      Launch a GOVERNED session (the dashboard path) into a worktree. After it has written state at least
      once (submit a prompt), inspect the worktree directory tree and the global store.
    expected: >-
      The worktree contains NO `.session/` dir and no per-session SpexCode files at all (only the spec/code
      work + the project-level .spexcode/ materialized dir). The session's record + launcher artifacts
      (prompt, launch.sh, hooks.json, claude.md) + state live under
      ${SPEXCODE_HOME}/projects/<enc-main-root>/sessions/<session_id>/.
  - name: multi-agent-one-folder-no-clobber
    tags: [backend-api]
    description: >-
      In ONE folder, run two agents with distinct harness session_ids concurrently (e.g. two self-launched
      codex/claude, or simulate two payloads with different session_id through the hooks). Have each flip its
      state.
    expected: >-
      Two DISTINCT global records appear (keyed by each session_id); each agent's mark-active writes only its
      own record; neither clobbers the other. (A worktree-path key would have collided — this is why the key
      is session_id.)
  - name: stop-gate-no-misfire-for-self-launch
    tags: [backend-api]
    description: >-
      Fire the Stop hook for a NON-governed session (a self-launched agent — its global record has
      governed:false, or no governed flag). Then fire Stop for a GOVERNED session that is undeclared and has
      uncommitted/0-ahead work.
    expected: >-
      Non-governed Stop → the stop-gate exits 0 SILENTLY (no decision-block JSON, no "declare your session
      state" demand). Governed undeclared/uncommitted Stop → the gate blocks exactly as today (commit gate +
      declare gate, with the loop-break). The governance flag is the only thing that flips this.
  - name: spec-discipline-runs-for-non-governed
    tags: [backend-api]
    description: >-
      A NON-governed (self-launched) agent's FIRST code access (read or edit a non-spec file) without having
      opened its node's spec, then a second code access.
    expected: >-
      spec-first blocks ONCE (its sentinel now lives in the global session record, not a worktree .session),
      then the second access passes — i.e. spec-discipline fires for self-launched agents too, NOT gated on
      governed. spec-of-file likewise annotates the first edit of a file for a non-governed agent.
  - name: dashboard-equivalence-governed
    tags: [backend-api]
    description: >-
      Run a GOVERNED (dashboard-launched) session end to end: submit a prompt, ask a question, do work,
      propose done. Compare board/lifecycle behavior to the pre-refactor baseline.
    expected: >-
      Behaviorally identical to before: mark-active flips active↔asking (AskUserQuestion → asking with the
      question as note); the Stop gate's commit + declare gates behave as today; the session appears on the
      board with the same status/liveness composition. Only the STORAGE moved (worktree .session → global
      record) — observable behavior is unchanged.
  - name: board-enumerates-global-store
    tags: [backend-api]
    description: >-
      With several governed sessions and at least one non-governed (self-launched) record present, run
      `spex ls` and open the dashboard board.
    expected: >-
      The board lists exactly the GOVERNED sessions, read from ${SPEXCODE_HOME}/projects/<enc>/sessions/*,
      ordered by createdAt; node id / branch / title / liveness come from the record. Non-governed
      self-launched records are NOT listed. Removing a session cleans up its global record.
  - name: resume-offline-session-rests-idle
    tags: [backend-api]
    description: >-
      Take a governed session offline (`exit`, or let its agent die) so the dashboard shows the relaunch
      panel, then hit resume (the frontend relaunch button → `POST /api/sessions/:id/resume`, i.e. reopen)
      WITHOUT sending any prompt afterwards. Read the session's status once the agent is back online.
    expected: >-
      The resumed session rests at `idle` (displayed idle, not `working`) — the agent is `--resume`d into the
      same conversation but sitting at its prompt with nothing to do, so it never shows a phantom `working`
      before the human says anything. Only the next real prompt (via mark-active) flips it to active. reopen
      demotes a working `active` to idle under the same active-only guard `idle` uses.
  - name: resume-preserves-standing-proposal
    tags: [backend-api]
    description: >-
      Put a session into review (lifecycle awaiting, proposal=merge) and resume it (reopen) WITHOUT the agent
      resuming work — isolate reopen's write via the online path (POST /review then POST /resume on a live,
      paused agent, so there is no relaunch and no mark-active). Read the record.
    expected: >-
      reopen preserves the standing proposal: the record stays `awaiting` with proposal `merge` intact (board
      shows review), NOT silently withdrawn to idle. reopen never touches the `proposal` field. A proposal is
      reversed only when the agent actually WORKS again (its mark-active hook) or by the merge dispatch's
      delivered prompt — never as a hidden side-effect of the relaunch itself.
  - name: propose-close-echoes-cleanup-reminder
    tags: [backend-api]
    description: >-
      Declare a close proposal for a governed session (`spex session done --propose close`) and read the
      command's confirmation output; then declare a merge (or nothing) proposal and read that output too.
    expected: >-
      The propose-close confirmation carries the plain, advisory cleanup reminder — reclaim the ephemeral
      things you started to test this change (a stray process, a dev/preview server, a bound port, a scratch
      session), keyed on whether a resource should outlive the task and never on who started it, stated as a
      nudge and not a gate. The merge/nothing confirmations do NOT carry it. The reminder is project-agnostic
      (no repo-specific paths), so it reads the same in any adopted project.
  - name: long-note-truncation-transparent
    tags: [backend-api]
    description: >-
      With an isolated SPEXCODE_HOME and a governed record, declare each note-carrying state — `spex session
      done --propose nothing --note <long>`, `ask --note <long>`, `park --note <long>` — where <long> exceeds
      the board table's note display cap. Read (1) the record's stored note, (2) the declaration's echo, and
      (3) the `spex ls` NOTE column. Repeat with a short note under the cap.
    expected: >-
      The note reaches the record IN FULL for all three verbs (done included — it must not silently drop its
      --note). The board table still truncates for display, but the truncation is TRANSPARENT to the author
      — taught ONCE per session: the FIRST overflowing note's declaration echo states the note's length, how
      many chars the board table shows, and where the full text is readable (the session record / `spex ls
      --json` / `spex review`); SUBSEQUENT overflowing declarations in the same session carry NO repeat of
      that notice (the rule was taught; repeating it verbatim on every park/ask is noise). A short note gets
      no such line ever. The echo is a nudge riding the confirmation — the declaration lands regardless,
      nothing gates.
  - name: no-record-diagnosis-self-explains
    tags: [backend-api]
    description: >-
      From a governed worker shell (session env var present), cd OUTSIDE the session's project and declare —
      (1) from a directory that is not a git repository at all (e.g. /tmp), (2) from a DIFFERENT git repo —
      `spex session park --note <x>` each time. Then (3) from inside the project, declare with a bogus
      `--session` id, and (4) from a plain shell with no session env and no --session.
    expected: >-
      No case crashes with a raw git stack trace, and no case answers a bare "no session record". Each
      failure SAYS WHY in terms of the actual cause: the store resolves from the CURRENT directory, so (1)
      and (2) name the cwd, state that it is not inside the session's project (a non-repo says so), and route
      the fix — cd back into the session's worktree and re-declare; (3) states the store WAS found here but
      holds no such session id (wrong --session); (4) states no session id is resolvable (no harness env) and
      points at --session <id>. The declaration still writes nothing — only the diagnosis changed.
  - name: probe-failure-reads-unknown-not-offline
    tags: [backend-api]
    description: >-
      With a governed live session on the board, inject a liveness-PROBE failure — make the tmux window-list
      snapshot time out / error (the load-30 condition), e.g. point the probe at a wedged tmux or force the
      bounded timeout to fire. Read the session's liveness on the board (listSessions / `spex graph --json`). Contrast
      with a genuinely-empty tmux server (no sessions), which exits cleanly non-zero.
    expected: >-
      The session STILL appears (it is enumerated from the durable store — it never vanishes) and its liveness
      reads `unknown` (probe-failed), NEVER `offline`/`closed` and never a stale `working`. A clean "no server /
      no sessions" is DISTINCT — that authoritatively reads `offline`. Only a probe TIMEOUT/kill yields
      `unknown`: the board never guesses a death from a failed probe, so a slow box cannot masquerade as a
      graveyard (the lie that drove the mass-restore). The bounded probe timeout also means a hung tmux can't
      freeze board assembly (no vanished/frozen list). `unknown` shows no relaunch panel.
  - name: dead-claude-reads-offline-within-seconds
    tags: [backend-api]
    description: >-
      Launch (or stub) a governed claude session and confirm it reads `online`. KILL the claude process but
      leave its tmux pane/wrapper AND its stale rendezvous socket FILE on disk. Re-read the board liveness a
      few seconds later. (A = the pre-fix reading; B = after the listener-verify fix.)
    expected: >-
      A (fail) — the old file-existence check (`existsSync(rvSock)`) read the dead pane as `online`/`working`
      for as long as the stale socket file lingered (the incident's "dead pane stuck working for 30+ min").
      B (pass) — liveness verifies a live LISTENER (a `connect()` probe): with claude dead nothing accepts on
      the socket, so it reads `offline` within seconds and surfaces the relaunch panel. The socket FILE merely
      existing is never sufficient; a stale file refuses the connect (ECONNREFUSED) and reads offline.
  - name: wedged-listener-reads-unknown-not-offline
    tags: [backend-api]
    description: >-
      A governed claude session whose agent process is ALIVE and LISTENING on its rendezvous socket, but
      whose listener cannot complete a connect right now — the load-thrash condition: the probe's connect
      times out (blocked event loop) or the kernel backlog is saturated (EAGAIN). tmux window alive
      throughout. Read the board liveness (/api/sessions), and run `spex wait <id>` against that backend.
    expected: >-
      The session reads `unknown` (unproven death), NEVER `offline`: a timed-out or queue-full connect proves
      nothing about death — EAGAIN in particular proves a LIVE listener whose queue is full. Only a proven
      refusal (ECONNREFUSED off a stale file / ENOENT with the window gone past boot grace) reads offline.
      Consequently `spex wait` keeps polling through the wedge (exiting by its own timeout if nothing
      changes) and never prints a false actionable `offline` verdict off a successful backend answer whose
      probe merely failed.
  - name: resume-on-alive-refuses-loud
    tags: [backend-api]
    description: >-
      With a governed session whose claude child is genuinely ALIVE, invoke the human relaunch — `POST
      /api/sessions/:id/resume` / `spex session resume` — WITHOUT force. Then repeat with `--force`,
      and separately exercise the merge dispatch (resume guard:false) on the same live agent.
    expected: >-
      A (fail) — pre-fix resume trusted a possibly-stale board liveness and would kill+relaunch a live agent
      SILENTLY (the incident's kill-shot: restore-on-alive killed live workers mid-work). B (pass) — resume
      re-derives liveness FRESH (the listener-verified probe) and REFUSES LOUD on a live agent: the API answers
      409 and the dashboard relaunch panel shows the refusal, the live worker is untouched. An `unknown`
      (probe-failed) liveness ALSO refuses — death is unproven. `--force` is the ONLY way to relaunch an alive
      agent (the wedged-but-alive escape, a deliberate kill). The merge dispatch (guard:false) is exempt: it
      reuses an already-online agent without refusing, and relaunches only a confirmed-offline one.
---
# eval.md — state

The session lifecycle is measured through the REAL board + hook round-trip (YATU). The refactor's invariants
to hold under measurement: (1) the worktree carries ZERO per-session files; (2) the store is keyed by harness
session_id so concurrent agents in one folder never collide; (3) the `governed` flag — not a `.session/`
presence — gates the board-lifecycle hooks, so a self-launched Stop never misfires; (4) spec-discipline is
universal; (5) governed/dashboard behavior is byte-for-byte equivalent to before. Always isolate SPEXCODE_HOME.
