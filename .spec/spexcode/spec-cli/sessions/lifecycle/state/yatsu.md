---
scenarios:
  - name: worktree-has-zero-session
    description: >-
      Launch a GOVERNED session (the dashboard path) into a worktree. After it has written state at least
      once (submit a prompt), inspect the worktree directory tree and the global store.
    expected: >-
      The worktree contains NO `.session/` dir and no per-session SpexCode files at all (only the spec/code
      work + the project-level .spexcode/ materialized dir). The session's record + launcher artifacts
      (prompt, launch.sh, hooks.json, claude.md) + state live under
      ${SPEXCODE_HOME}/projects/<enc-main-root>/sessions/<session_id>/.
  - name: multi-agent-one-folder-no-clobber
    description: >-
      In ONE folder, run two agents with distinct harness session_ids concurrently (e.g. two self-launched
      codex/claude, or simulate two payloads with different session_id through the hooks). Have each flip its
      state.
    expected: >-
      Two DISTINCT global records appear (keyed by each session_id); each agent's mark-active writes only its
      own record; neither clobbers the other. (A worktree-path key would have collided — this is why the key
      is session_id.)
  - name: stop-gate-no-misfire-for-self-launch
    description: >-
      Fire the Stop hook for a NON-governed session (a self-launched agent — its global record has
      governed:false, or no governed flag). Then fire Stop for a GOVERNED session that is undeclared and has
      uncommitted/0-ahead work.
    expected: >-
      Non-governed Stop → the stop-gate exits 0 SILENTLY (no decision-block JSON, no "declare your session
      state" demand). Governed undeclared/uncommitted Stop → the gate blocks exactly as today (commit gate +
      declare gate, with the loop-break). The governance flag is the only thing that flips this.
  - name: spec-discipline-runs-for-non-governed
    description: >-
      A NON-governed (self-launched) agent's FIRST code access (read or edit a non-spec file) without having
      opened its node's spec, then a second code access.
    expected: >-
      spec-first blocks ONCE (its sentinel now lives in the global session record, not a worktree .session),
      then the second access passes — i.e. spec-discipline fires for self-launched agents too, NOT gated on
      governed. spec-of-file likewise annotates the first edit of a file for a non-governed agent.
  - name: dashboard-equivalence-governed
    description: >-
      Run a GOVERNED (dashboard-launched) session end to end: submit a prompt, ask a question, do work,
      propose done. Compare board/lifecycle behavior to the pre-refactor baseline.
    expected: >-
      Behaviorally identical to before: mark-active flips active↔asking (AskUserQuestion → asking with the
      question as note); the Stop gate's commit + declare gates behave as today; the session appears on the
      board with the same status/liveness composition. Only the STORAGE moved (worktree .session → global
      record) — observable behavior is unchanged.
  - name: board-enumerates-global-store
    description: >-
      With several governed sessions and at least one non-governed (self-launched) record present, run
      `spex ls` and open the dashboard board.
    expected: >-
      The board lists exactly the GOVERNED sessions, read from ${SPEXCODE_HOME}/projects/<enc>/sessions/*,
      ordered by createdAt; node id / branch / title / liveness come from the record. Non-governed
      self-launched records are NOT listed. Removing a session cleans up its global record.
---
# yatsu.md — state

The session lifecycle is measured through the REAL board + hook round-trip (YATU). The refactor's invariants
to hold under measurement: (1) the worktree carries ZERO per-session files; (2) the store is keyed by harness
session_id so concurrent agents in one folder never collide; (3) the `governed` flag — not a `.session/`
presence — gates the board-lifecycle hooks, so a self-launched Stop never misfires; (4) spec-discipline is
universal; (5) governed/dashboard behavior is byte-for-byte equivalent to before. Always isolate SPEXCODE_HOME.
