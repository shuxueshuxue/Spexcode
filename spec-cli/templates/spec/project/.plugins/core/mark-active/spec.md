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

This is the freshness half of the [[core]] discipline: it keeps the board honest about whether a session is working, waiting, or asking, so the gates and the dashboard read a true present state rather than a stale one.
