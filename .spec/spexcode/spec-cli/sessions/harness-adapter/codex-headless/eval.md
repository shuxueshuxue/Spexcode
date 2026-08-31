---
scenarios:
  - name: conversation-live-tail
    tags: [frontend-e2e, desktop, backend-api]
    description: >-
      Through a running backend and the real `codex-headless` launcher, dispatch a session whose prompt runs a slow
      shell command, reads a file, lists a directory, runs a second slow command, and finally declares `ask`.
      In a real browser open its Conversation and, every few seconds while it works, read the open seam's
      lead and counts, the live tail's prose and tool sentences, which call wears the running mark, and the
      record's messages; keep reading until the declaration lands.
    expected: >-
      The open seam reads `working · <duration>` with `N turns · M tool uses` growing as the native thread
      grows; the live tail beneath it shows the agent's newest prose and every call after it in order, the
      call without a recorded result marked running and the mark leaving when its result lands; no trace row,
      card, or pop-out exists; and when the agent declares, the seam closes to `worked <duration>`, the tail
      leaves, and the declared note is the newest message on the record. No page errors.
  - name: codex-headless-real-loop
    description: Through a running backend and the real `codex-headless` launcher, create a session, wait for the initial app-server turn to finish, then send a follow-up to the idle session.
    expected: The session is online with `{ headless: true }`; its pane has no resident Codex TUI after the first turn, and the idle send is accepted as a new app-server `turn/start` on the same thread.
    code: [spec-cli/src/codex-headless.ts]
    tags: [backend-api, cli]
  - name: codex-headless-explicit-stop-resume
    description: Let a real governed codex-headless session settle with a declaration note, explicitly stop it, then resume it while reading graph, CLI, tmux, and timeline state.
    expected: Stop preserves the owned thread, record, and timeline but reads offline; resume returns the same Codex conversation online with the pre-stop declaration note intact.
    code:
      - spec-cli/src/harness.ts#sessionHomeLiveness
      - spec-cli/src/codex-harness.ts#codexHeadlessHarness
      - spec-cli/src/sessions.ts
    tags: [backend-api, cli]
  - name: codex-headless-resume-reloads-an-evicted-thread
    description: >
      Take a real governed codex-headless session whose thread the shared app-server has EVICTED from its loaded
      set (thread/loaded/list does not include it, though its rollout is intact on disk — the natural state of a
      completed/idle session after the server drops it). Confirm the thread is not resident, then resume the
      session through the public session API and read its liveness.
    expected: >
      Before resume the readiness census cannot see the thread (not in the loaded set) so a bare resume would
      time out. Resume reopens the thread into the shared app-server (thread/resume, running no turn and
      streaming no history), the loaded-set census then includes it, and the session returns online with its
      prior declaration note intact — not "launch did not become ready".
    code:
      - spec-cli/src/codex-harness.ts#codexResumeThread
      - spec-cli/src/codex-harness.ts#codexHeadlessHarness
      - spec-cli/src/cli.ts
    tags: [backend-api, cli]
  - name: codex-headless-live-steer
    description: While a real codex-headless app-server turn is in progress, send a second prompt through the public session command.
    expected: The delivery is accepted by `turn/steer` on the owned thread and no second Codex process or TUI is spawned.
    code: [spec-cli/src/codex-headless.ts]
    tags: [backend-api, cli]
  - name: codex-headless-close-residue
    description: Close the real codex-headless session through the public session API and inspect its process, tmux, worktree, branch, sockets, and record store.
    expected: The session closes with no per-session process, pane, worktree, branch, record, or socket residue; the shared project app-server is not mistaken for session-owned residue.
    code: [spec-cli/src/codex-headless.ts]
    tags: [backend-api, cli]
  - name: codex-headless-finished-turn-closes-through-public-api
    tags: [backend-api, cli]
    code: [spec-cli/src/codex-headless.ts, spec-cli/src/sessions.ts]
    description: >-
      Through the public `spex session new --launcher codex-headless` path, run a trivial no-edit task whose final
      work action is a tool call, wait for `done --propose close` and `close-pending`, then invoke `spex session
      close` immediately and inspect the native rollout tail and retained session record.
    expected: >-
      The native rollout has a terminal task-complete event, the record is close-pending before close, and the
      public close succeeds without an active-turn refusal; the session is retired and its worktree is removed.
  # harness-delivery-campaign:start
  - name: delivery-combo-codex-headless-launch-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "codex-headless / launch / idle" }
    description: >-
      Through the real codex-headless launcher, measure the launch first prompt path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      The immediate native poke is observed at the product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-codex-headless-launch-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "codex-headless / launch / in-turn" }
    description: >-
      Through the real codex-headless launcher, measure the launch first prompt path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      The cell is reported BLOCKED because a launch first prompt creates its turn and cannot be
      injected into a pre-existing in-progress turn. The runner invents no substitute launch or
      private transport, and the remaining launch/idle cell carries launch-path coverage.
  - name: delivery-combo-codex-headless-dashboard-note-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "codex-headless / dashboard-note / idle" }
    description: >-
      Through the real codex-headless launcher, measure the dashboard note composer path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      The immediate native poke is observed at the product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-codex-headless-dashboard-note-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "codex-headless / dashboard-note / in-turn" }
    description: >-
      Through the real codex-headless launcher, measure the dashboard note composer path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      The immediate native poke is observed at the product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-codex-headless-cli-send-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "codex-headless / cli-send / idle" }
    description: >-
      Through the real codex-headless launcher, measure the CLI session send path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      The immediate native poke is observed at the product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-codex-headless-cli-send-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "codex-headless / cli-send / in-turn" }
    description: >-
      Through the real codex-headless launcher, measure the CLI session send path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      The immediate native poke is observed at the product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  # harness-delivery-campaign:end
---

Measure through one real `codex-headless` launcher and the public `spex session` verbs. Store backend/CLI output
as transcript evidence; the idle-send scenario must include the exact same-thread `turn/start` acceptance, and
the live-steer scenario must include `turn/steer` acceptance. File readings only after the implementation commit
so the evidence `codeSha` names the measured tree.
