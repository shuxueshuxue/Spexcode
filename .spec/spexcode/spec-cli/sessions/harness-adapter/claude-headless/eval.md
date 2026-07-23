---
scenarios:
  - name: launch-stream
    description: Launch a real governed claude-headless session through `spex session new`, then observe its public session state and stored native message stream.
    expected: The session becomes online, completes the initial turn through Claude Code headless, and its messages.ndjson contains newline-delimited native Claude events with no SpexCode wrapper.
    tags: [backend-api, cli]
    code: [spec-cli/src/claude-headless.ts]
  - name: deliver-active
    description: Send a follow-up through `spex session send` while the real headless Claude turn is inside a long-running tool call.
    expected: The send succeeds once, the message reaches the live child at the next tool boundary, and no second Claude process or duplicate user event is created.
    tags: [backend-api, cli]
    code: [spec-cli/src/claude-headless.ts]
  - name: deliver-idle-resume
    description: Let a real headless turn finish and its child exit, then send another prompt through the public session command.
    expected: Delivery starts `claude -p --resume` with the same session id, preserves the earlier conversation, and appends the resumed turn's native events to the same messages.ndjson.
    tags: [backend-api, cli]
    code: [spec-cli/src/claude-headless.ts]
  - name: interrupt-continue
    description: Interrupt a real long-running headless turn through `spex session interrupt`, then send a new prompt to the same session.
    expected: The interrupt is confirmed by Claude's matching control_response, the running turn ends promptly, and the next prompt continues the same conversation successfully.
    tags: [backend-api, cli]
    code: [spec-cli/src/claude-headless.ts]
  - name: record-liveness
    description: Read the public session state with and without a resident turn child, and after deliberately making the controller transport unreachable while leaving session.json intact.
    expected: The intact record always reads online; the unreachable controller is reported only as a loud deliver failure, and removing the session record removes the session rather than producing an offline row.
    tags: [backend-api, cli]
    code: [spec-cli/src/claude-headless.ts]
  - name: hooks-and-close
    description: Exercise a real Claude lifecycle hook and then close the governed headless session through the public session API.
    expected: The Claude-identical shim fires against the governed record, and close leaves no tmux window, child/controller process, control socket, worktree, branch, session record, or messages.ndjson residue.
    tags: [backend-api, cli]
    code: [spec-cli/src/claude-headless.ts]
  # harness-delivery-campaign:start
  - name: delivery-combo-claude-headless-launch-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "claude-headless / launch / idle" }
    description: >-
      Through the real claude-headless launcher, measure the launch first prompt path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-claude-headless-launch-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "claude-headless / launch / in-turn" }
    description: >-
      Through the real claude-headless launcher, measure the launch first prompt path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      The cell is reported BLOCKED because a launch first prompt creates its turn and cannot be
      injected into a pre-existing in-progress turn. The runner invents no substitute launch or
      private transport, and the remaining launch/idle cell carries launch-path coverage.
  - name: delivery-combo-claude-headless-dashboard-note-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "claude-headless / dashboard-note / idle" }
    description: >-
      Through the real claude-headless launcher, measure the dashboard note composer path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-claude-headless-dashboard-note-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "claude-headless / dashboard-note / in-turn" }
    description: >-
      Through the real claude-headless launcher, measure the dashboard note composer path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-claude-headless-cli-send-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "claude-headless / cli-send / idle" }
    description: >-
      Through the real claude-headless launcher, measure the CLI session send path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-claude-headless-cli-send-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "claude-headless / cli-send / in-turn" }
    description: >-
      Through the real claude-headless launcher, measure the CLI session send path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  # harness-delivery-campaign:end
---

Measure through a real `claude-headless` launcher and the public `spex session` verbs. Store command/API output as
transcript evidence; timed active-turn delivery and interrupt scenarios use video when the dashboard interaction
is measured, otherwise a timestamped CLI transcript with explicit send/response/event boundaries.
