---
title: pi-headless
status: active
hue: 292
desc: pi's non-interactive text-mode harness adapter: pi materialization, record-backed liveness, native rendezvous steer, and exact-session cold resume.
code:
  - spec-cli/src/pi-headless.ts
related:
  - spec-cli/src/harness.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/help.ts
  - spec-cli/src/pi-harness.ts
  - spec-cli/src/pi-headless.test.ts
  - spec-cli/templates/spexcode.json
---

# pi-headless

pi's `-p` form is an independent harness adapter with id `pi-headless`, not a mode of the interactive pi
adapter. It keeps pi's materialized surface exactly, but replaces the interactive runtime with a resident
controller in the session's tmux window. It uses pi's default text output; `--mode json` is deliberately not
used because it can hang on the supported local runtime.

The adapter is literal object composition over `piHarness` for shim, contract, skills, trust, slash commands,
events, and session identity. Its runtime is record-backed: while the governed session record exists it reports
`online`; a missing controller, child, or rendezvous listener is surfaced by delivery as a loud transport error.
The adapter does not persist a native message stream.

The controller starts a fresh turn with `pi -p --session-id <id> <prompt>`. A delivery first probes pi's
rendezvous socket. When a listener is present, the existing `deliverViaRendezvous` protocol sends
`sendUserMessage(..., deliverAs: steer)` into the live turn. When the listener is proven absent, the controller
spawns `pi -p --session <id> <msg>` to wake the exact saved conversation; `--session-id` is never used for this
path because it can silently create a new session. The controller remains resident so the tmux window is a
stable home for later deliveries and resumes.

