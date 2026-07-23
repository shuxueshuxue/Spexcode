---
scenarios:
  - name: opencode-headless-materialized-system-context-live
    tags: [backend-api, cli]
    description: >-
      Launch a real opencode-headless session through SpexCode with a temporary primary agent whose resolved
      permissions deny `read`, `glob`, `grep`, `bash`, `webfetch`, and `skill`. Ask for the exact uppercase
      titles of disciplines 2 and 4 without naming either title; capture text-mode output and native export.
    expected: >-
      The model answers `COMMIT BEFORE YOU DECLARE|KEEP THE LOSS SIGNAL HONEST` from OpenCode run's startup
      AGENTS.md context. The native export contains no tool call, and the generated SpexCode plugin loads in
      headless mode; artifact presence or a later file read is not accepted as proof.
  - name: opencode-headless-materialized-skill-live
    tags: [backend-api, cli]
    description: >-
      Launch a real opencode-headless session through SpexCode with a temporary primary agent that denies
      every file, search, shell, and web tool while allowing only OpenCode's native `skill` tool. Ask it to
      load `taste`, return the exact title of principle 14, and capture text-mode output plus native export.
    expected: >-
      OpenCode run discovers `.opencode/skills/taste/SKILL.md`, records a successful native `skill` tool call
      for `taste`, and the model answers `Capabilities enter the ecosystem through the pillars we already
      stand on`; no general file or shell tool is available to imitate skill loading, and the plugin loads.
  - name: opencode-headless-record-liveness
    description: Launch a real governed opencode-headless session, wait for its first turn to exit, and inspect the public session state while the turn process and rendezvous listener are absent.
    expected: The intact session record remains online and its terminal-free conversation stays available while the native conversation sleeps.
    tags: [backend-api, cli]
    code: [spec-cli/src/opencode-headless.ts]
  - name: opencode-headless-idle-wake
    description: Send a note-backed prompt to the real governed session after its first turn exits and capture the public send/result plus the model reply.
    expected: Delivery starts exactly one `opencode run --session <captured-id> <prompt>` turn in the session tmux home and the real model answers in the same conversation.
    tags: [backend-api, cli]
    code: [spec-cli/src/opencode-headless.ts]
  - name: opencode-headless-live-steer
    description: While a real opencode-headless turn is running with its plugin rendezvous socket bound, send a second prompt through the public session send surface.
    expected: The existing parse-confirmed rendezvous transport accepts the prompt exactly once through `client.session.prompt`; no second turn process or PTY input bridge is used.
    tags: [backend-api, cli]
    code: [spec-cli/src/opencode-headless.ts]
  - name: opencode-headless-fail-loud
    description: Remove the session's turn home, then send a prompt through the public session send surface.
    expected: Delivery returns a non-success result naming the failed wake; it never records a sent message or silently falls back to terminal typing.
    tags: [backend-api, cli]
    code: [spec-cli/src/opencode-headless.ts]
  - name: opencode-headless-wake-turn-fail-loud
    description: Through the public session send surface, cold-wake a real governed session with an OpenCode launcher whose turn process exits non-zero immediately after spawn.
    expected: Delivery returns non-success with the observed turn exit, the active-only turn-outcome CAS records lifecycle error, and no sent-success event is recorded merely because tmux accepted the respawn.
    tags: [backend-api, cli]
    code: [spec-cli/src/opencode-headless.ts]
  # harness-delivery-campaign:start
  - name: delivery-combo-opencode-headless-launch-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "opencode-headless / launch / idle" }
    description: >-
      Through the real opencode-headless launcher, measure the launch first prompt path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-opencode-headless-launch-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "opencode-headless / launch / in-turn" }
    description: >-
      Through the real opencode-headless launcher, measure the launch first prompt path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      The cell is reported BLOCKED because a launch first prompt creates its turn and cannot be
      injected into a pre-existing in-progress turn. The runner invents no substitute launch or
      private transport, and the remaining launch/idle cell carries launch-path coverage.
  - name: delivery-combo-opencode-headless-dashboard-note-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "opencode-headless / dashboard-note / idle" }
    description: >-
      Through the real opencode-headless launcher, measure the dashboard note composer path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-opencode-headless-dashboard-note-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "opencode-headless / dashboard-note / in-turn" }
    description: >-
      Through the real opencode-headless launcher, measure the dashboard note composer path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-opencode-headless-cli-send-idle
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "opencode-headless / cli-send / idle" }
    description: >-
      Through the real opencode-headless launcher, measure the CLI session send path at idle/wake: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  - name: delivery-combo-opencode-headless-cli-send-in-turn
    tags: [backend-api, cli]
    test: { path: spec-eval/scenarios/harness-delivery-campaign.mjs, name: "opencode-headless / cli-send / in-turn" }
    description: >-
      Through the real opencode-headless launcher, measure the CLI session send path at in-turn steer/queue: use
      only `spex session new`, the public `/api/sessions/:id/input` route, or plain
      `spex session send`, then read the public timeline/board and the real pane where applicable.
    expected: >-
      Delivery is confirmed by the native product surface; the answer is readable as a timeline status note containing the answer marker;
      every observed liveness value is truthful for the live session; and a post-delivery authored
      declaration is present. A missing default note hint on a headless target is a failure.
  # harness-delivery-campaign:end
---

Measure through one real `opencode-headless` launcher and the public `spex session` verbs. Store the command,
board, and model-reply transcript as result evidence; source inspection and unit tests are auxiliary only.
