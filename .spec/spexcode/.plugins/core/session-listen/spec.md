---
title: session-listen
surface: hook
status: active
hue: 280
events:
- SessionStart
- UserPromptSubmit
order: 20
block: true
---
The backend-free self-launch message loop. On `SessionStart`, it initializes the harness's native session id in the
adopter protocol database; initialization is idempotent and creates no governed lifecycle record. On each
`UserPromptSubmit`, it performs exactly one at-most-once `spex-session dequeue` for that same native id. A message
body is decoded and emitted as the harness's `hookSpecificOutput.additionalContext` JSON, so the harness input seam
receives it without a resident process or wake-hint dependency. An empty queue is a successful no-op and emits no
stdout. The hook never derives a database path: the adopter CLI owns path resolution and locality checks.

Every external delivery tool is checked before `dequeue`, so a broken PATH cannot consume a message. The opaque body
is decoded to a temporary file, validated as UTF-8, and rejected loudly (with its `messageId` and original
`bodyBase64`) when it contains NUL or other JSON-hostile control bytes. Clean text is escaped with the existing awk
toolchain without command substitution, preserving embedded and trailing newlines; a non-empty body can never become
an empty additionalContext success.

The CLI is resolved at runtime through one explicit seam: a non-empty `SPEX_SESSION_CLI` wins, otherwise PATH is
searched for `spex-session`. If either protocol database environment variable is configured and no CLI can be
resolved, the hook fails loudly with an installation or `SPEX_SESSION_CLI` repair entrypoint. With neither database
variable configured, the project has not adopted this capability, so the hook exits silently without trying another
delivery path. Only these two events are bound: startup establishes the address, and prompt submission is the natural
harness input seam; a configured-but-broken adopter is a blocking hook failure so dispatch cannot hide it. There is no
daemon, polling, retry loop, observer, governed record, or compatibility path.
