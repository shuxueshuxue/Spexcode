# Codex 0.146 rollout fixture

Two rollouts captured 2026-08-29 from real `codex-headless` sessions (meeting participants in bench 3.9; `…-prose` is the one that answered in prose, the other answered only through `spex session ask` tool calls) after the session was
closed — Codex had moved the rollout to `~/.codex/archived_sessions/`. Elided: the injected AGENTS.md instruction
text and reasoning bodies. The shapes this pins:

- `event_msg/agent_message` now carries `message: ""` with `phase: "final_answer"` — the assistant's prose is in
  `response_item/message` (`role: "assistant"`, `content: [{type: "output_text", text}]`).
- the person's message appears twice: `event_msg/user_message` (plain text) and `response_item/message`
  (`role: "user"`, `content: [{type: "input_text", text}]`); the latter also carries harness injections that were
  never typed by a person.
- tool calls: `response_item/custom_tool_call` + `custom_tool_call_output` (unchanged).
