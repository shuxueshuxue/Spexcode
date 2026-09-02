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
The startup `SPEX_PROFILE` hook list may disable this lifecycle hook with a clean no-op; `full` and profiles that include `session-listen` retain it.
The backend-free self-launch message loop. On `SessionStart`, it initializes the harness's native session id in the
adopter protocol database; initialization is idempotent and creates no governed lifecycle record. On each
`UserPromptSubmit`, it performs exactly one at-most-once `spex-session dequeue` for that same native id. A message
body is decoded and emitted as the harness's `hookSpecificOutput.additionalContext` JSON, so the harness input seam
receives it without a resident process or wake-hint dependency. An empty queue is a successful no-op and emits no
stdout. The hook never derives a database path: the adopter CLI owns path resolution and locality checks.

Every external delivery tool and each non-default operation it supplies is proven with a fixed result vector before
`dequeue`, so a binary that exists but lacks or misimplements the required flag cannot consume a message. In
particular, `base64 -d` must decode `QQ==` to exactly the one byte `0x41`; checking only its exit status would admit a
shim that merely copies input. `-d` is used because GNU base64 on Linux and base64 on both fleet Macs running macOS
15.6.1 were measured to decode that vector correctly; this is an observed common capability, not a platform legend.
The opaque body
is decoded to a temporary file, validated as UTF-8, and rejected loudly (with its `messageId` and original
`bodyBase64`) when it contains NUL or other JSON-hostile control bytes. Clean text is escaped with the existing awk
toolchain without command substitution, preserving embedded and trailing newlines; a non-empty body can never become
an empty additionalContext success.

**A delivery failure never costs the person their own prompt.** This hook runs ON prompt submission, so blocking
is not a way of being loud — it deletes what someone just typed. Two different failures did that. A dequeue that
errors consumes nothing, and yet the prompt was thrown away for it. And a failure AFTER a successful dequeue had
already lost the peer message, because the queue is at-most-once; blocking cannot bring it back and only takes a
second casualty. So every failure inside the delivery path reports itself through the SAME channel the message
would have used — an `additionalContext` notice, and the same line on stderr — and lets the prompt through. A
failure before the dequeue says that nothing was consumed and the message is still queued. A failure after it
carries the `messageId` and the `bodyBase64`, because at that point the notice IS the recovery path. What stays
blocking is the environment: a configured-but-broken adopter, and the capability probes that run before the
dequeue precisely so a message is never consumed by a shell that cannot deliver it.

The CLI is resolved at runtime through one explicit seam: a non-empty `SPEX_SESSION_CLI` wins, otherwise PATH is
searched for `spex-session`. If either protocol database environment variable is configured and no CLI can be
resolved, the hook fails loudly with an installation or `SPEX_SESSION_CLI` repair entrypoint. With neither database
variable configured, the project has not adopted this capability, so the hook exits silently without trying another
delivery path. Only these two events are bound: startup establishes the address, and prompt submission is the natural
harness input seam; a configured-but-broken adopter is a blocking hook failure so dispatch cannot hide it. There is no
daemon, polling, retry loop, observer, governed record, or compatibility path.
