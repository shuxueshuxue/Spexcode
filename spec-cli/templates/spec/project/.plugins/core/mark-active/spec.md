---
title: mark-active
surface: hook
status: active
hue: 200
events:
- UserPromptSubmit
- PreToolUse
order: 10
block: false
---
The single freshness signal for a session. Any work a session does — a new prompt, or any tool about to run — flips its declared state to `active`, which also drops a now-stale proposal or note: once the agent is moving again, an old "ready to merge" claim no longer stands. The one exception is asking the human: when the tool is AskUserQuestion the state becomes `asking`, carrying the question itself as the note, so a pause for the human is captured deterministically without the agent having to also declare it.

The state is read from ONE structured field in the hook payload, never sniffed from the terminal UI, so the signal is hard rather than guessed. Because it fires before the tool runs, a deliberate [[stop-gate]] declaration (itself made via a tool) lands after this and wins; the next real tool flips back to `active`, forcing a fresh declaration at the following stop. It is pure shell so it stays cheap firing on every tool call.

The one activity that does NOT count as the session acting is an IN-PROCESS SUBAGENT's tool call (the harness's Task tool — a sub-conversation inside the same process). Such a call fires the parent's hooks carrying the parent's `session_id`, so without a discriminator a supervising parent could never hold a declared state: its own subagents erased every park/ask within seconds and raced the stop-gate into "undeclared stop". The harness stamps subagent-executed calls with a top-level `agent_id` field the parent's own calls never carry; `hp_is_subagent` reads that stamp deterministically (scanning only the pre-`tool_input` payload prefix, where a tool parameter or file content can never fake an unescaped key), and this hook skips the flip entirely. A subagent working is its parent supervising, not the parent moving on — the parent's own next tool call still flips as before.

It is a board-lifecycle hook, so it acts only on a GOVERNED (dashboard-launched) session — it resolves that session's runtime envelope in the global per-session store from the payload's `session_id` and no-ops unless `governed: true`. Lifecycle state is written to the canonical session application; `runtime.json` is not a lifecycle authority. The hook never edits that envelope itself: it hands every lifecycle write to `spex internal session-state`, the one structured writer the CLI declarations use — an asking note is arbitrary prose, and a shell that substitutes prose into existing JSON eventually writes a record nothing can parse.

This hook carries no conversation. A message addressed to the session reaches its agent as an ordinary prompt through the harness adapter (delivery-queue), which is the only way anything enters a turn. The one protocol exception is a managed watch notice: the canonical `[spex watch] ` prefix identifies a supervision snapshot, not work performed by the receiving agent, so UserPromptSubmit for that exact wire form does not flip the receiver to `active`. Other inter-agent prompts remain ordinary prompt activity. A hook that also injected mail delivered every message a second time and made the agent's context depend on which of two paths won a race; a freshness signal reports a fact about the session and hands nothing over.

This is the freshness half of the [[core]] discipline: it keeps the board honest about whether a session is working, waiting, or asking, so the gates and the dashboard read a true present state rather than a stale one.

## legacy handler migration

For the two known pre-structured `mark-active` source blobs still tracked by existing projects, dispatch performs
a bounded migration at the adapter boundary: it executes the current package-owned structured implementation,
and the next materialize replaces the old tracked handler with that implementation. This is a migration of a
legacy source identity, not a second lifecycle protocol or a permanent backward-compatibility path. The old
handler's envelope writes are never allowed to author current lifecycle state.
