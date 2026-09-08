---
title: idle
surface: hook
status: active
hue: 200
events:
- Notification
order: 10
block: false
---
The startup `SPEX_PROFILE` hook list may disable this lifecycle hook with a clean no-op; `full` and profiles that include `idle` retain it.
Catches the undeclared stop the [[stop-gate]] misses. When the harness signals — via an idle-prompt notification — that the agent is simply sitting idle at its prompt rather than working, this hook marks the session `idle`, so a session that quietly ran out of things to do is not left reading as active on the board.

It acts only on the idle-prompt notification, ignoring every other notification kind. As a board-lifecycle hook it passes the payload's acting `session_id` to `spex internal session-idle --session <id>`; the canonical writer owns governed-session resolution and returns a no-op for self-launched or missing records. It is guarded so it never clobbers a deliberate declaration: marking idle applies only to a session still in the undeclared `active` state, leaving any considered `awaiting`, `asking`, `parked`, or `error` claim untouched. Together with [[stop-gate]] and [[session-fail]] it closes the last gap where a session could stop without its true state reaching the board.
