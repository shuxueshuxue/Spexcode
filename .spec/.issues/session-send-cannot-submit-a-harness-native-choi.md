---
concern: session send cannot submit a harness-native choice dialog without raw terminal keys
by: 58195f32-61b8-4e69-9b91-b41fc2594501
status: open
nodes: dispatch
created: 2026-07-26T06:26:57.883Z
---

Observed in session 078f8cdf: the worker correctly paused on a native AskUserQuestion choice. Plain spex session send delivered the manager's answer into the conversation but did not select or submit the already-focused option; progress required spex session send --keys Enter. That raw-key face is intentionally documented as unstable, last-resort, and capable of confirming dangerous dialogs, so it must not become the routine control path for a normal structured question.\n\nDesired contract: the resolved harness adapter exposes a safe, scoped way to answer a native structured question, or refuses loudly with a stable recovery entrypoint. The manager should not have to infer terminal focus or inject confirmation keys. Preserve dispatch's existing rule that ordinary prompts never fall back silently to PTY typing; this needs an explicit structured-control capability rather than a hidden sendText fallback.\n\nEvidence is the 078f asking state and the successful one-key workaround after plain text delivery was visibly received but left the dialog open.
