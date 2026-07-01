---
scenarios:
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
---
# yatsu.md — state

The session lifecycle is measured through the REAL board + hook round-trip (YATU). The refactor's invariants
to hold under measurement: (1) the worktree carries ZERO per-session files; (2) the store is keyed by harness
session_id so concurrent agents in one folder never collide; (3) the `governed` flag — not a `.session/`
presence — gates the board-lifecycle hooks, so a self-launched Stop never misfires; (4) spec-discipline is
universal; (5) governed/dashboard behavior is byte-for-byte equivalent to before. Always isolate SPEXCODE_HOME.
