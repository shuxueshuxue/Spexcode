---
title: shared-runtime-generation-rotation
status: active
hue: 205
desc: A durable detached-v3 generation ledger routes new Codex traffic to one canonical root while exact older roots drain without blocking target archive or close.
code:
  - spec-cli/src/codex-runtime-generations.ts
related:
  - spec-cli/src/harness.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/host-resources.ts
  - spec-cli/src/codex-runtime-generations.test.ts
  - spec-cli/src/codex-runtime-generation.yatu.test.ts
---

# shared-runtime-generation-rotation

## raw source

A project can inherit a live Codex app-server root that SpexCode did not create or cannot safely
replace. Its native threads may include governed work, unowned interactive clients, and other
native peers. Treating that one root as both the future routing point and the prerequisite for
every close turned unrelated protective references into a permanent close-pending deadlock.

## expanded spec

Codex shared runtime ownership is a durable **detached-v3 generation ledger** in the project
runtime store, never a mutable singleton PID/socket convention. A generation records its immutable
endpoint (PID file, detached receipt, socket path and socket identity), its state (`current`,
`draining`, or `reclaimed`), and exact governed bindings of `{ sessionId, threadId, generationId }`.
The record is private runtime state; the worktree, branch, and Codex conversation remain unchanged.

### Switch

The first managed launch beside a legacy root creates a new detached-v3 endpoint in its own
generation directory, proves its exact PID/start/process-group/receipt/socket identity, then CASes
the ledger's `current` pointer to it. The old endpoint is entered as `draining` and is never killed,
rewritten, or treated as the new root. The compare-and-swap is durable and restart-safe: a crashed
or competing switch leaves either the old published pointer or one fully-proved current generation;
an incomplete, replaced, or ambiguous candidate fails loudly and is not adopted by signature.

New Spex Codex traffic resolves the current pointer at the launch boundary. A newly started native
thread is bound to that exact generation before it is accepted as the governed session's thread.
Legacy governed records with an already-known native thread are bound to the observed legacy
generation during ledger bootstrap. A session operation may only use its stored exact binding;
missing, mismatched, or ambiguous bindings are refusals, never a fallback to the current root.

### Drain

A draining generation remains addressable for its bound governed sessions and for every unowned or
native peer it already hosts. Archive, close, delivery, resume, and cold proof choose the target
session's bound endpoint, so an unrelated reference on an older root neither migrates nor blocks a
target on another generation. Active governed sessions can move only through their normal explicit
resume/retire path; the ledger never moves a native conversation behind their back.

Resource inventory reports every generation separately and keeps loaded unowned references
protective. A draining root is reclaimable only after the same exact PID/start/receipt/socket
identity is still present and its native loaded-reference census, governed bindings, and peer count
are all zero. Reclamation rechecks those facts immediately before acting. Names, command lines,
or a matching socket filename are never ownership evidence. Ambiguity retains both roots.

### Lifecycle safety

Target archive and archived close prove/unload only the target's bound generation and native
subtree. They may census unrelated IDs only to protect that exact control plane; they never require
those IDs to answer target reads, migrate, unload, or disappear. A successful archive projects the
target offline, and close removes only that exact target's worktree, branch, record, and binding.
Failure leaves the row and all non-target roots intact, so a close-pending session cannot be
reported online merely because some other generation remains live.

The ledger's reads, bootstrap, switch, retry after restart, binding, and reclamation are idempotent.
The isolated backend scenario covers a 22-reference legacy root (13 governed, 9 unowned protective,
5 active, plus native peers): new sessions route to the new current generation, protected legacy
references survive, target archive becomes offline, and close removes only merged targets.
