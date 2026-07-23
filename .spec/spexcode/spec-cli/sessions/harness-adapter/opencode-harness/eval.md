---
scenarios:
  - name: plugin-bridge-mechanical
    tags: [cli]
    code: spec-cli/src/opencode.ts
    test:
      path: spec-cli/src/opencode.test.ts
      name: whole file
    description: >-
      Run the mechanical layer end to end WITHOUT an opencode binary: generate the plugin with
      opencodePluginSource, load it, and drive its hooks with a stub dispatch.sh (recording every payload,
      blockable per event) and a fake SDK client. Also branch the launch script against a stub `opencode` on
      PATH, and deliver a prompt with the REAL deliverViaRendezvous against the plugin's own socket server
      (`npx tsx --test spec-cli/src/opencode.test.ts`).
    expected: >-
      Every payload reaching dispatch.sh is claude-SHAPED (session_id = the governed record id, Claude tool
      names, filePath→file_path) with the harness id `opencode` as argv[1]; a child session's events carry
      agent_id BEFORE tool_input (the harness.sh prefix-scan contract); a PreToolUse block THROWS and a Stop
      block re-injects the gate reason as a prompt (the stop-gate loop); the launch script maps a prompt tail
      to --prompt, a --resume marker to --session <id>, a --continue marker to --continue; and
      deliverViaRendezvous returns parse-CONFIRMED ok with the text landing in the session — claude's
      transport reused verbatim, zero opencode transport code.
  - name: adopted-repo-grows-opencode-artifacts
    tags: [cli]
    description: >-
      In a throwaway git repo, run the real `spex init .`, inspect the tree, then narrow spexcode.json's
      `harnesses` to ["claude","codex"] and re-run `spex materialize`.
    expected: >-
      init materializes .opencode/plugins/spexcode.ts (the generated plugin, dispatch.sh command baked), the
      AGENTS.md managed block, and .opencode skill artifacts, all exclude-hidden; narrowing the set prunes
      every .opencode artifact AND sweeps the emptied .opencode/ home itself — the third native harness rides
      the same select/erase/assert pipeline with no special case.
  - name: deliver-second-message
    tags: [backend-api]
    code: [spec-cli/src/opencode.ts]
    description: >-
      Matrix row: `spex session send` a task to the settled (idle) worker that starts a long turn,
      then send a SECOND message while that turn is in flight — all under normal board-probe
      pressure (the runner polls the board throughout).
    expected: >-
      Both sends exit 0; the idle send lands EXACTLY once (no duplicate injection of the message
      text); the mid-turn send reaches the LIVE turn — its steer marker shows in that same turn's
      output — never dropped, never duplicated.
  - name: dispatched-opencode-worker-e2e
    tags: [backend-api]
    description: >-
      Through the running product: add an opencode launcher ({"harness":"opencode","cmd":"opencode --auto"}),
      dispatch a worker onto a node task, and watch the whole lifecycle — SessionStart/mark-active flip the
      board to working, the plugin's first event stores harness_session_id, an undeclared stop is BLOCKED by
      the stop-gate with the reason re-injected, `spex session send` lands mid-run, kill + resume re-attaches
      the SAME opencode conversation (--session <id>), and the commit carries the Session trailer.
    expected: >-
      Indistinguishable from a claude worker on the board and in git: live status honest (socket-preferred,
      pid-fallback), deliver confirmed, resume continuous, declarations attributed to the right record.
      NOTE: needs a box with opencode model credentials — unmeasured where none exist (this box, 2026-07-16);
      the mechanical layer above is measured, this end-to-end reading is the open item.
  - name: undeclared-stop-gate-rejection
    tags: [backend-api]
    code: [spec-cli/src/opencode.ts]
    description: >-
      Live-behavior matrix row (run by `spex eval matrix <launcher>`): dispatch a real worker of
      this harness with a controlled prompt that answers one line and stops WITHOUT declaring, then
      watch the settle from the outside — no steering, no help.
    expected: >-
      The stop-gate's rejection reaches the session — the gate's teach sentinel is planted and the
      record flows out of `active` into a declared status (asking/review) on its own. The failure
      signature is a record stuck `active` forever with the rejection silently dropped.
  - name: pretooluse-block-live
    tags: [backend-api]
    code: [spec-cli/src/opencode.ts]
    description: >-
      Matrix row: plant a transient `surface: hook` node (PreToolUse, block: true) guarding one
      marked file in the live worker's worktree, `spex materialize` there, then tell the worker to
      modify the guarded file; sweep the node and re-materialize afterwards.
    expected: >-
      The tool call is genuinely blocked — the guarded file's content is untouched — and the
      handler's OWN reason (a unique marker) is visible to the agent, who reports it; the session
      continues normally after the block.
  - name: ask-note
    tags: [backend-api]
    description: >-
      Matrix row: the live worker runs `spex session ask --note '<question>'` (its own declaration
      verb, from inside its worktree) with a unique marker in the note.
    expected: >-
      The record flips to `asking` with the note carried verbatim where the board reads it (`spex
      session show`), attributed to the right record.
  - name: deliver-mid-turn
    tags: [backend-api]
    description: >-
      Matrix row: `spex session send` a task to the settled (idle) worker that starts a long turn,
      then send a SECOND message while that turn is in flight — all under normal board-probe
      pressure (the runner polls the board throughout).
    expected: >-
      Both sends exit 0; the idle send lands EXACTLY once (no duplicate injection of the message
      text); the mid-turn send reaches the LIVE turn — its steer marker shows in that same turn's
      output — never dropped, never duplicated.
  - name: resume-continuity
    tags: [backend-api]
    description: >-
      Matrix row: seed the live worker with a token to remember, `spex session stop` it (tmux
      killed, worktree kept), `spex session resume` it, then ask for the token back without
      repeating it.
    expected: >-
      The resumed agent continues the SAME conversation — it answers with the seeded token from
      prior context in a fresh RECALL=<token> line — never a fresh empty session; the board returns
      to online.
  - name: liveness-signals
    tags: [backend-api]
    description: >-
      Matrix row: SIGKILL an ESTABLISHED agent's whole process tree out from under the pane (the
      kill lands outside the launcher boot-grace window; the tmux window and any stale socket file
      stay), read board liveness until it flips; then `spex session resume` and read again.
    expected: >-
      Liveness reads `offline` within seconds of the kill — a stale socket FILE never reads as
      alive; the adapter's own per-harness signal decides — and after resume the session reads
      online again.
  - name: commit-gate-rejection
    tags: [backend-api]
    description: >-
      Matrix row: the runner plants an uncommitted file in the live worker's worktree and the worker
      runs `spex session done --propose merge`; the gate must reject the dirty proposal, and a
      committed re-proposal must be accepted.
    expected: >-
      The dirty proposal is rejected at settle with the reason delivered into the session (the
      record never stands as review while the tree is dirty); once the work is committed the same
      proposal is accepted (status review) and the commit carries the `Session:` trailer attributing
      it to this record.
  - name: close-residue
    tags: [backend-api]
    description: >-
      Matrix row: `spex session close` the worker, then sweep the box — tmux window, surviving
      processes of that worktree, the worktree directory and node branch, the session record and its
      global store dir.
    expected: >-
      Zero residue: the tmux window is gone, no process of that worktree survives, worktree and
      branch are retired, and the session's record/store dir is swept (durable history lives in git
      and the eval filings, not the record).
  # harness-delivery-campaign:start
  - name: delivery-combo-opencode-launch-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "opencode / launch / idle" }
    description: >-
      Through the real opencode launcher, measure the launch first prompt path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as the interactive TUI pane containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-opencode-launch-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "opencode / launch / in-turn" }
    description: >-
      Through the real opencode launcher, measure the launch first prompt path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      The cell is reported BLOCKED because a launch first prompt creates its turn and cannot be
      injected into a pre-existing in-progress turn. The runner invents no substitute launch or
      private transport, and the remaining launch/idle cell carries launch-path coverage.
  - name: delivery-combo-opencode-dashboard-note-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "opencode / dashboard-note / idle" }
    description: >-
      Through the real opencode launcher, measure the dashboard note composer path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-opencode-dashboard-note-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "opencode / dashboard-note / in-turn" }
    description: >-
      Through the real opencode launcher, measure the dashboard note composer path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-opencode-cli-send-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "opencode / cli-send / idle" }
    description: >-
      Through the real opencode launcher, measure the CLI session send path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as the interactive TUI pane containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-opencode-cli-send-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "opencode / cli-send / in-turn" }
    description: >-
      Through the real opencode launcher, measure the CLI session send path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as the interactive TUI pane containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  # harness-delivery-campaign:end
---

Measured YATU through the generated artifacts and the real CLI: the plugin file the adapter actually
materializes is loaded and driven as opencode would drive it; adoption goes through the real `spex init`
in a scratch repo. The e2e scenario runs through a real dispatched opencode worker once credentials exist.
