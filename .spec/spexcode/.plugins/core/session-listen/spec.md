---
title: session-listen
surface: hook
status: active
hue: 280
desc: Self-launch registration: on SessionStart it asks the product CLI to initialize the harness’s native session id as a protocol address in the project’s canonical store, and stays silent where no ready store exists.
events:
- SessionStart
order: 20
block: true
---
The startup `SPEX_PROFILE` hook list may disable this lifecycle hook with a clean no-op; `full` and profiles that include `session-listen` retain it.
The registration hook for a harness a person started themselves (the self-launch entry node). On `SessionStart` it runs
`spex internal session-register <native-session-id>` through the same `$SPEX` every other materialized hook uses; the
CLI initializes that id as a protocol address in the project's canonical session store. Initialization is idempotent,
creates no governed lifecycle record, and is harmless for a governed session whose address already exists.

Adoption is decided by the store, not by environment variables: the CLI registers only when the resolved canonical
store already exists and is `ready`, and answers `skipped: <reason>` otherwise, so a project with no governed backend
gets no store created on its behalf and nothing else happens. A CLI that cannot run or fails while a ready store exists
is a blocking registration failure (exit 2) — a self-launched harness that silently failed to register would be one
that `spex session send` refuses for no visible reason.

The hook does not read messages on any event: receipt is the caller's own act through the inbox verbs (`dequeue`,
`wait-dequeue`, `stream-dequeue`) or the backend's push for a governed session. There is no prompt hook, dequeue,
daemon, polling, retry loop, observer, governed record, second CLI, or compatibility path.
