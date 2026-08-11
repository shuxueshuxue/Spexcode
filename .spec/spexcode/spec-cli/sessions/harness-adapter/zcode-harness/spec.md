---
title: zcode-harness
status: active
hue: 195
desc: The z-code adapter — its Claude-compatible hook settings, launcher, and payload parsing expressed as one Harness data row.
code:
  - spec-cli/src/harness.ts
related:
  - spec-cli/hooks/harness.sh
  - spec-cli/src/harness.test.ts
  - spec-cli/src/harness-select.test.ts
  - spec-cli/src/claude-headless.test.ts
  - spec-cli/src/codex-headless.test.ts
  - spec-cli/src/opencode.test.ts
  - spec-cli/src/opencode-headless.test.ts
  - spec-cli/src/pi-headless.test.ts
---

# zcode-harness

z-code joins the native [[harness-adapter]] registry as the `zcode` data row. The adapter owns every z-code fact; materialization, lifecycle gates, and session product code continue to resolve the adapter and never branch on its id.

z-code discovers Claude-compatible command hooks from `.zcode/settings.json`. Its shim binds the five lifecycle events that SpexCode needs — `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, and `Stop` — with each command dispatching the baked `zcode` harness id. Materialization proves that wiring, but it is not runtime proof: the generated `Stop` command must consume `zcode` as its harness id, select the current tree's manifest, and execute the blocking Stop gate against the governed record. z-code has no `Notification` or `StopFailure`, so the existing Claude-only idle state is unavailable and no substitute event is fabricated. The payload is Claude-shaped, so the shell mirror routes `zcode` through the existing Claude-family parser rather than adding a second parser.

Those five are what SpexCode binds, not z-code's whole hook vocabulary — `PermissionRequest` and `PostToolUseFailure` also exist and are currently unbound. That is a coverage gap on SpexCode's side, not a missing z-code capability, and `PostToolUseFailure` is the one that costs something real: repeated tool failure is a common shape of a stuck worker, and it is the shape this adapter currently cannot see.

The launcher is the vendored CLI's non-interactive `zcode --prompt <prompt>` route. `launchCmd` supplies `--prompt`, and SpexCode's ordinary launch tail supplies that first prompt, so a new session starts with exactly the requested work. This is a one-turn, no-TUI process: the adapter declares `headless: true` and `launchOneShot: true`, so generic boot logic neither treats its intentional exit as a failed TUI nor retries the prompt. There is one `zcode` row, not a `zcode-headless` twin: the existing `*-headless` rows each own a resident controller and multi-turn delivery semantics, which this one-shot launcher deliberately does not claim.

z-code has no reclaude rendezvous socket, and its app-server speaks JSON-RPC as stdin/stdout NDJSON rather than the Codex adapter's Unix-socket WebSocket plus thread RPC, so that control path is not reusable. This adapter's implemented surface therefore ends at launch, hooks, and process liveness: `deliver` and `resume` explicitly fail with `zcode has no control channel; start a new session instead of delivering to an existing one`. The one-shot launcher has no task-summary pane title, so `paneTitleIsSelfSummary` is false and the board uses the launch-prompt headline.

That boundary is deliberate, and the reason is not that z-code cannot be driven. It can: its app-server accepts external `session/create`, `subscribe`, and `send` on an idle registered session, and it pushes a rich event stream. The reason is that **the gate may not acquire a standing dependency.** Self-start is the primary case — a developer running z-code directly, with no dashboard and no server, must still be governed — so the gate rides the hook plane, which costs nothing when nobody is watching and scales with events rather than with observers. The event plane's cost grows as (observers × observed), which is a defect at this layer. Stated as the rule it came from: the gate may not use it, observation may.

So there are two tiers, and the degradation between them must be loud rather than silent. The **floor** is the hook plane: portable, zero standing cost, present on a bare checkout, and what every lifecycle gate binds. The **rich tier** is the app-server protocol event stream, available only while something is connected, carrying what hooks cannot see — child sub-agent lifecycle among it, because the native sub-agent runner constructs its `AgentRuntime` without a `hookRunner`, so a child's own hooks never fire and only the parent's `SubagentSpawned`/`Message`/`Stopped` events describe it. Observation built on the rich tier anchors on V4's structured `SubagentRow` — `status`, `summaryText`, `childSessionId`, `parentToolCallId`, `endedAt`, `backgrounded` — which is cold-replayable and hydratable, so a dashboard that connects late still recovers the history. The legacy wire's `SubagentStopped → session.updated` with a pass-through payload is a measured observation of the old skin, not the contract to build on: it carries no schema and no revision.

Worktree isolation transfers cleanly, with no registration step to install. A V4 `createSession` may carry a **local directory path directly as `workspaceId`**; the bridge treats it as the `workspacePath` and opens the session with that directory as its working directory, so one node per worktree needs no prior app-side enrolment — the failure-prone install-time dependency that would otherwise be disqualifying here does not exist. Two limits bound that: an input-less `createSession` yields only a deferred draft and persists nothing until a first input promotes it, and a remote directory requires a well-formed `remote:ssh|wsl|docker|server:…` identity. This adapter does not use that route today; it launches `zcode --prompt`.

Because both systems name sessions, correspondence is declared rather than inferred. The top-level z-code launch
inherits its SpexCode `SPEXCODE_SESSION_ID`; a configured tool/hook executing for a native child additionally has
that child's `ZCODE_SESSION_ID`. When that child needs a SpexCode eval glance, it posts the explicit
`{ childSessionId }` pair to the owning SpexCode session's `zcode-child-sessions` route. The persistent relation
is exact, unique per live child id, and omitted if the tool cannot establish it; neither timestamps nor paths
reconstruct it later. SpexCode keeps node claim, worktree, atomic landing, and the spec-before-code gate — z-code
has no concept of landing, and overlays derive from git, which z-code never produces. z-code keeps delegation
lineage and in-session children. The outer layer holds one worktree and one top-level worker per node; z-code's
native children serve sub-tasks inside that worker, and never nest.
