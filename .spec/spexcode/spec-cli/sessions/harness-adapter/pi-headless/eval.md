---
scenarios:
  - name: pi-headless-real-loop
    description: >-
      Through a running backend and the real `pi-headless` launcher, create a session, observe the initial
      text-mode response, send a prompt after the turn is idle, then start a long tool turn and send a second
      prompt while the rendezvous listener is live.
    expected: >-
      The initial turn completes in pi's default text mode, idle delivery resumes the exact same session with
      `pi -p --session <id>`, and the active-turn delivery uses the existing rendezvous steer path exactly once;
      the public record remains online and reports `{ headless: true, messageStream: false }`.
    tags: [backend-api, cli]
    code: [spec-cli/src/pi-headless.ts]
  - name: pi-headless-close-residue
    description: Close the real pi-headless session through the public session API and inspect its process, tmux, worktree, sockets, and record store.
    expected: The controller and pi children stop, both controller and rendezvous sockets are gone, and the session worktree, branch, record, and store leave no residue.
    tags: [backend-api, cli]
    code: [spec-cli/src/pi-headless.ts]
  # harness-delivery-campaign:start
  - name: delivery-combo-pi-headless-launch-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "pi-headless / launch / idle" }
    description: >-
      Through the real pi-headless launcher, measure the launch first prompt path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-pi-headless-launch-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "pi-headless / launch / in-turn" }
    description: >-
      Through the real pi-headless launcher, measure the launch first prompt path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      The cell is reported BLOCKED because a launch first prompt creates its turn and cannot be
      injected into a pre-existing in-progress turn. The runner invents no substitute launch or
      private transport, and the remaining launch/idle cell carries launch-path coverage.
  - name: delivery-combo-pi-headless-dashboard-note-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "pi-headless / dashboard-note / idle" }
    description: >-
      Through the real pi-headless launcher, measure the dashboard note composer path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-pi-headless-dashboard-note-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "pi-headless / dashboard-note / in-turn" }
    description: >-
      Through the real pi-headless launcher, measure the dashboard note composer path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-pi-headless-cli-send-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "pi-headless / cli-send / idle" }
    description: >-
      Through the real pi-headless launcher, measure the CLI session send path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-pi-headless-cli-send-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "pi-headless / cli-send / in-turn" }
    description: >-
      Through the real pi-headless launcher, measure the CLI session send path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  # harness-delivery-campaign:end
---

Measure with a real `pi-headless` launcher and public `spex session` verbs. Use a transcript for the backend/CLI
loop and include the exact session id, listener observations, and response markers; close is measured after the
session has been retired and the residue sweep has completed.
