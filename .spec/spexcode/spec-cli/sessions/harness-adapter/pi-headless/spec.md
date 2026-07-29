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
events, and session identity. Its runtime is record-backed: while the governed session record exists and is not
explicitly stopped it reports `online`; a missing controller, child, or rendezvous listener is surfaced by
delivery as a loud transport error. Human `stop` tears down the runtime and marks the retained record stopped,
so it reads `offline` until `resume` clears the marker and relaunches the same conversation. Its text output
remains a transport detail; the note timeline is the terminal-free conversation.

The controller starts a fresh turn with `pi -p --session-id <id>` and gives pi the turn's TEXT on **stdin**,
never in argv. pi's own parser has no end-of-options separator and errors on any argv token beginning with `-`,
so a turn whose text starts with one — a pasted console line, a diff hunk — would die at parse time with the
human's own words quoted back; pi reads its prompt from stdin when argv carries none, and the controller owns
its child's stdio, so that channel is available here even though the interactive sibling (whose TUI owns stdin)
must refuse such a prompt outright ([[harness-adapter]]'s `promptArg`). Every turn takes that one route: the
text is delivered byte-for-byte whatever it begins with, and there is no leading-`-` special case to get wrong.
A delivery first probes pi's
rendezvous socket. When a listener is present, the existing `deliverViaRendezvous` protocol sends
`sendUserMessage(..., deliverAs: steer)` into the live turn. When the listener is proven absent, the controller
spawns a `--session <id>` turn to wake the exact saved conversation; `--session-id` is never used for this
path because it can silently create a new session. The controller remains resident so the tmux window is a
stable home for later deliveries and resumes.

Each controller child reports a non-zero exit through the shared [[harness-adapter]] turn-outcome seam. The active
undeclared record therefore becomes `error` with the pi turn's exit code, while zero exits and an agent-authored
declaration that landed before teardown remain authoritative. Record-backed `online` still describes a controller
that can accept a later delivery; it no longer masks the failed turn.
