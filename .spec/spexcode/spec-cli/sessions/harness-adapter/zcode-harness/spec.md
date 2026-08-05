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

z-code discovers Claude-compatible command hooks from `.zcode/settings.json`. Its shim binds the five lifecycle events that SpexCode needs — `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, and `Stop` — with each command dispatching the baked `zcode` harness id. z-code has no `Notification` or `StopFailure`, so the existing Claude-only idle state is unavailable and no substitute event is fabricated. Its extra hook events are outside SpexCode's gate contract. The payload is Claude-shaped, so the shell mirror routes `zcode` through the existing Claude-family parser rather than adding a second parser.

The launcher is the vendored CLI's non-interactive `zcode --prompt <prompt>` route. `launchCmd` supplies `--prompt`, and SpexCode's ordinary launch tail supplies that first prompt, so a new session starts with exactly the requested work. This is a one-turn, no-TUI process: the adapter declares `headless: true` and `launchOneShot: true`, so generic boot logic neither treats its intentional exit as a failed TUI nor retries the prompt. There is one `zcode` row, not a `zcode-headless` twin: the existing `*-headless` rows each own a resident controller and multi-turn delivery semantics, which this one-shot launcher deliberately does not claim.

z-code has no reclaude rendezvous socket. Its app-server speaks JSON-RPC as stdin/stdout NDJSON, whereas the Codex adapter's control path is Unix-socket WebSocket plus Codex thread RPC; those transports are not reusable. This adapter's native capability therefore ends at launch, hooks, and process liveness: `deliver` and `resume` explicitly fail with `zcode has no control channel; start a new session instead of delivering to an existing one`. That is current behavior, not a fallback or a TODO. The one-shot launcher has no task-summary pane title, so `paneTitleIsSelfSummary` is false and the board uses the launch-prompt headline.
