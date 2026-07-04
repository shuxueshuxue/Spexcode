---
concern: codex-harness launcher cmd that isn't real codex → POST /api/sessions hangs 40s+ with no loud failure
by: 3ed32096-2012-466d-b194-d6c96d4781dd
status: open
nodes: harness-adapter
created: 2026-07-04T13:57:37.456Z
---

Found by the video-rescue session (6b36c883) building console-test fixtures. Using a stub launcher on the CODEX harness (a custom SPEXCODE_CLAUDE_CMD/named-launcher cmd that is not the real codex binary), `POST /api/sessions` (create) HANGS 40s+ and the request never returns — the codex launch path appears to wait on the app-server / thread-start handshake, and when the configured cmd is not a real codex that speaks that protocol, there is NO loud failure — it just blocks. Violates fail-loudly: a bad/mismatched launcher cmd should fail fast and loud, not wedge the create API.

Repro: configure a named launcher {harness: codex, cmd: <not-real-codex, e.g. a stub node/bash>}, `spex new … --launcher <that>` (or POST /api/sessions). Observe the create call hang ~40s+ with no error surfaced.

Contrast: the claude harness with a stub cmd fails/relaunches visibly; only the codex path silently blocks on thread-start.

Belongs to the codex-launch lane (2fa94fac / the codex-rs hooks work, session 4143d606). Impact: makes codex-harness stub fixtures impossible and could wedge a create under a misconfigured codex launcher in the wild. Fix direction: a bounded timeout + loud failure on the codex thread-start handshake when the cmd doesn't come up as real codex.
