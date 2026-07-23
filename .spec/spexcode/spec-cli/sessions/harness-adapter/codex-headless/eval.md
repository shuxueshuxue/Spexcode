---
scenarios:
  - name: codex-headless-real-loop
    description: Through a running backend and the real `codex-headless` launcher, create a session, wait for the initial app-server turn to finish, then send a follow-up to the idle session.
    expected: The session is online with `{ headless: true, messageStream: false }`; its pane has no resident Codex TUI after the first turn, and the idle send is accepted as a new app-server `turn/start` on the same thread.
    code: [spec-cli/src/codex-headless.ts]
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
  # harness-delivery-campaign:start
  - name: delivery-combo-codex-headless-launch-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "codex-headless / launch / idle" }
    description: >-
      Through the real codex-headless launcher, measure the launch first prompt path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
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
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
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
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
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
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
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
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  # harness-delivery-campaign:end
---

Measure through one real `codex-headless` launcher and the public `spex session` verbs. Store backend/CLI output
as transcript evidence; the idle-send scenario must include the exact same-thread `turn/start` acceptance, and
the live-steer scenario must include `turn/steer` acceptance. File readings only after the implementation commit
so the evidence `codeSha` names the measured tree.
