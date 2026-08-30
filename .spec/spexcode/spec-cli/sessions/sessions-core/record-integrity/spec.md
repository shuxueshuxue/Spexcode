---
title: record-integrity
status: active
hue: 280
desc: One typed writer for the per-session runtime envelope, three distinct readings of it (absent, corrupt, retired) that may never be collapsed, the launch-readiness publication fence, and the guard that tells a dead leaf from an unprovable one.
code:
  - spec-cli/src/session-record.ts
related:
  - spec-cli/src/session-record-integrity.test.ts
  - spec-cli/test/session-record-integrity-fixture.ts
  - packages/spec-core/src/layout.ts
  - spec-cli/src/session-record-lock.ts
  - spec-cli/src/session-tmux.ts
---

# record-integrity

[[sessions-core]] keeps every session's runtime envelope on disk, and this node is why a reader can trust what it
finds there: one writer composes the bytes, and a read has three outcomes that mean different things. Collapsing
them is what once made a live session answer "no session record".

**The runtime/worktree envelope of `runtime.json` is produced by ONE writer here**, by serializing the typed
record and landing it by atomic replace, and NOTHING else may compose or edit that file's text — not a hook,
not a shell, not a route. After JSON migration, lifecycle (`status`, `proposal`, `note`, and `parent`) is owned
only by the canonical session application and its events; the envelope is runtime metadata and is never written from
canonical lifecycle state. `session.json` is migration input only and is retired once the migration marker is published.
A record whose `runtime_owner` names an external controller is instead written by
[[runtime-session]] under the same record lock and is `governed:false`; this module may read it but never launch,
stop, or rewrite it. Its opaque `runtime_state` and idempotency `runtime_revision` extend the canonical disk
format without turning ZCode state into SpexCode lifecycle policy. The reason for a single typed writer per
ownership mode is the `note`: it is arbitrary human/agent prose, so any writer that substitutes it into
existing JSON eventually meets a quote, a backslash, or a newline and leaves a record nothing can parse. Both
note-carrying entries — the agent's typed declaration and the hook's capture of an asked question — therefore
land through the canonical application, and a note round-trips byte-for-byte on every surface. The shell hooks
call that package entry point for every event; it compares canonical state and emits no event for a semantic
no-op. They do not inspect or write JSON lifecycle fields ([[state]]).

The record module receives its legacy lifecycle notification and transition-serialization hooks from
`sessions.ts` through explicit setters. Their initial values are an inert notifier and a pass-through wrapper so
record-only readers and error-type consumers can import this module without constructing the session runtime;
all mutation paths in `sessions.ts` install the real hooks before they can write or quarantine a record. An
unwired mutation caller is outside the supported composition boundary rather than a second notification or
transition implementation.

A published create record is also the durable fence for any private pre-publication candidate receipt whose
best-effort retirement failed after the atomic record write. Terminal close holds the session record lock and
the exact recorded branch/path resource lock, retires a valid matching receipt, and proves it absent before
stopping or removing any public resource. After its target tmux kill, it also proves that exact session has no
pane left before accepting adapter cold proof or deleting durable resources. Failure preserves the row, store,
worktree, and branch; deleting the record first would let the old receipt regain cleanup authority over a later
name collision.

Launch readiness is the one durable internal publication fence within that record. Its pending value freezes
the exact pre-resume lifecycle/proposal/note/stopped/archived and offline projection while the raw candidate is
available to the adapter's post-launch validator. The record/layout boundary owns one public-record parser:
list/API/graph, resource owners and shared references, resolved-layout settings, and the timeline observer all
consume that same three-way projected entry rather than raw candidate fields. A successful fence clear
publishes the final record and its lifecycle event once; failure or stale recovery restores the original and
emits nothing. Malformed pending bytes are a corrupt/unknown public entry everywhere, never a reason to reuse a
last-known online row, perform a git walk, or infer an owner from candidate lifecycle fields. "Malformed"
includes a structurally complete original whose lifecycle or proposal string is outside the same closed enums
the typed session reader accepts. While the fence exists, the compact public display is pinned offline rather
than reconciled from candidate runtime evidence, even if the frozen original says `stopped:false` with an
`active`/`idle` lifecycle and a candidate process is live.

Reading a record has **three** outcomes and collapsing them is what once made a live session answer "no
session record". **Absent** is the legitimate nothing. **Corrupt** — present but unparseable — is a fact about
a session that EXISTS: it keeps its row (naming the file and the parse error, liveness `unknown` since nothing
was probed), and every writer refuses on it rather than repairing it into a plausible empty shell. A corrupt
record cannot prove the adapter, session leaf, worktree, or branch owner, so `close` may quarantine the original
bytes as control-plane evidence but then refuses loudly: it sends no signal and preserves the session runtime,
worktree, and branch, reporting those residues instead of guessing. Retiring only the corrupt row requires a
future record-only control-plane seam; it must not be approximated by skipping the runtime guard or by adding a
second process terminator. Any other read failure still throws:
a transient fault must read as neither. **Retired** is the third integrity reading, derived not stored: the
recorded worktree is gone, so there is nothing left to be active *in*. It is terminal — no lifecycle writer may
put it back to `active`/`idle`, and no delayed launch-readiness observer may replace its frozen note after the
worktree disappears. No launch is assembled for it; only `close` remains.

The leaf-ownership guard that gates every stop distinguishes **a dead leaf from an unprovable one**. Both look
alike from the recorded pid — neither yields a start identity — but they call for opposite answers. A pid that
names no live process has nothing to signal and nothing a signal could hit by mistake, so the leaf is already
in the state stop wants and teardown proceeds record-only, exactly as for an explicitly stopped record. A pid
that IS alive while refusing to prove its identity is the case the guard exists for, and it still refuses
loudly, because signalling it could kill whatever now wears that number. Collapsing the two into one refusal is
what made a session impossible to retire: a launcher that dies before readiness leaves a dead pid on the
record, and `stop` and `close` then both refused it forever — the row could be neither run nor closed, and
`quarantine` does not apply because the record is perfectly readable. Liveness is asked with the same probe the
escalation path already uses to tell a vanished leaf from a replaced one, so one question has one answer here.
