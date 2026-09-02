---
title: session-listen
surface: hook
status: active
hue: 280
events:
- SessionStart
order: 20
block: true
---
The startup `SPEX_PROFILE` hook list may disable this lifecycle hook with a clean no-op; `full` and profiles that include `session-listen` retain it.
The backend-free self-launch registration hook. On `SessionStart`, it initializes the harness's native session id in
the adopter protocol database; initialization is idempotent and creates no governed lifecycle record. The hook does
not read messages on `UserPromptSubmit`: message receipt is owned by backend push or by the caller, which chooses
when to dequeue. The hook never derives a database path: the adopter CLI owns path resolution and locality checks.

The CLI is resolved at runtime through one explicit seam: a non-empty `SPEX_SESSION_CLI` wins, otherwise PATH is
searched for `spex-session`. If either protocol database environment variable is configured and no CLI can be
resolved, the hook fails loudly with an installation or `SPEX_SESSION_CLI` repair entrypoint. With neither database
variable configured, the project has not adopted this capability, so the hook exits silently. A configured-but-broken
adopter is a blocking registration failure. There is no prompt hook, dequeue, daemon, polling, retry loop, observer,
governed record, or compatibility path.
