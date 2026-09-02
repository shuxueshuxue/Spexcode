---
title: codex-headless
status: active
hue: 205
desc: Codex's app-server thread form as an independent headless harness: Codex-identical materialization, record-backed liveness, and direct JSON-RPC turn delivery without a resident TUI process.
code:
  - spec-cli/src/codex-headless.ts
related:
  - spec-cli/src/codex-harness.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/codex-headless.test.ts
  - spec-cli/src/sessions-liveness.test.ts
  - packages/spec-core/templates/spexcode.json

---

# codex-headless

Codex's non-interactive app-server thread form is an independent [[harness-adapter]] with id
`codex-headless`, not a mode of the interactive Codex adapter. It keeps Codex's materialized project surface,
trust, and hook path exactly, while replacing only the visible runtime half.

## expanded spec

The adapter is literal object composition over `codexHarness`: its `.codex` shim and linked-worktree anchor,
`AGENTS.md` contract, skills, trust writer, hook events, slash commands, and bypass-hook-trust thread config are
unchanged. There is no second materializer and no headless branch in materialize or session product code.

The launch command reuses Codex's existing app-server bootstrap and `spex internal codex-launch` path. A fresh
launch starts the stable per-project app-server, calls `thread/start` for the governed worktree, sends the launch
prompt as the first turn, waits for the rollout to persist, and stages the returned thread id plus exact-payload
proof for the session lifecycle owner to bind under its record lock. It then exits;
there is deliberately no `codex --remote ... resume` TUI attach and no resident controller in the pane. The
shared app-server remains alive for every thread in the project. Its adapter marks this launch as one-shot so
the generic fast-exit recovery loop does not replay a successful first prompt into a duplicate thread.

Unlike the other headless adapters, Codex has a real shared resident control plane rather than a session-owned
host-container leaf. It therefore retains adapter runtime ownership and proves cold state through its exact generation
and loaded-thread census; it must not inherit the leaf/no-resident shortcut.

Delivery directly reuses Codex's existing app-server JSON-RPC transport. It reads the owned thread and sends
`turn/steer` while a turn is in progress or `turn/start` when the thread is idle, so an idle `spex session send`
starts the next turn without spawning a process or waking a pane. Socket, thread, and RPC failures fail loudly
through the public session API; there is no PTY typing or wake fallback.

When the one-shot first-turn process exits non-zero, the adapter reports that exit through the shared
[[harness-adapter]] turn-outcome seam before returning its failure. An active undeclared record becomes `error`
with the Codex exit code; a zero exit and any declaration already written are left untouched. The shared
app-server remains the liveness address only when it can accept another delivery.

The durable record identifies the liveness target, but it is not itself proof that the target is addressable. For
an identified thread the adapter first requires the exact shared generation (detached PID/start receipt and socket)
and the session layer joins one project-wide loaded-reference census before publishing `online`; a missing or
unhealthy census is `unknown`, and an identified thread absent from the loaded set is `offline`. A stale record
therefore cannot keep a dead or unloaded Codex thread online indefinitely. `headless: true` keeps it out of the
dashboard launcher picker by default and the note conversation is the console trunk. Human `stop` tears down the
session runtime and marks the retained record stopped, so it reads `offline` until a proven resume clears the
marker. Resume is the no-TUI form: an identified thread resumes by its exact marker, while a pre-identity recovery
replays the authoritative resolved launch payload; an absent shared server must be
recreated through the canonical delegated spawn before the record can return online. Because readiness proves
online only for a thread the shared app-server currently holds resident, and that server evicts an idle thread
from its loaded set, an identified resume must first reload its thread into the server before the readiness
census runs — the load a visible-TUI resume performs by attaching, which the headless form has no TUI to do. That
reload runs no turn and streams no history; it only makes the on-disk thread resident again, so a completed
session whose thread was evicted resumes to online instead of timing out its readiness on a thread that is intact
on disk. The adapter's launch
readiness is stricter than its steady-state record liveness: it proves one unchanged version-4 detached-launch
receipt through the shared process adapter (exact PID/start and process group everywhere, plus `/proc` session on
Linux, never Darwin `ps sess`) and composes it with the exact socket generation, the target's existing thread loaded under that
shared root, and exactly one governed record owner for that thread across every adapter record sharing the
descriptor. That owner must be the current SpexCode session; a deduplicated loaded-ID set is never ownership
evidence. The adapter returns those facts as one readiness fence. Resume durably records an internal pending
candidate only while the parent maintenance ticket is still live; every public projection continues to expose
the exact stopped/offline original. The same fence then repeats the complete generation/reference/owner proof
before one final write clears pending and publishes online state. An unload, shared-root restart,
duplicate/reassigned owner, refused helper, bounded timeout, or stale pending recovery retains/restores the
original record without a false lifecycle event and returns non-success. Closing remains the terminal
operation that removes the record, worktree, branch, pane, and shared runtime references owned by the session.

Every successful queued launch publication clears the retained `stopped` marker together with the active lifecycle.
Leaving `stopped: true` on an active record makes the readiness proof reject its own candidate while the witness probe
can still see the shared app-server, producing a false post-receipt readiness warning.
