---
title: sessions-core
status: active
hue: 280
desc: The shared session module every session feature builds on — the global per-session record I/O, worktree/branch/node resolution, and the launch/state/dispatch/poll plumbing the lifecycle and comms nodes each specialize.
code:
  - spec-cli/src/sessions.ts
related:
  - spec-cli/src/sessionSlug.test.ts
  - spec-cli/src/layout.ts
  - spec-cli/src/session-record-integrity.test.ts
  - spec-cli/test/session-record-integrity-fixture.ts
---
# sessions-core

## raw source

The session subsystem's features — lifecycle state, launch, dispatch, comms, the live graph, selectors,
the spec-pointer — all read and write ONE module, `sessions.ts`. It is shared substrate with no single
feature as its owner, so per-feature drift on it fanned the same change across a dozen nodes. Give it a
foundation owner: the features govern their own surfaces and REFERENCE this module via `related:`.

## expanded spec

sessions-core owns `sessions.ts` — the common session layer: the global per-session record read/write
(`session.json` keyed by session_id, [[runtime]]) with the record-integrity rules below, session↔worktree↔node resolution, the launch-script
assembly (the rendezvous env + the harness's own command + the spec-pointer/prompt tail — carrying NO
`--append-system-prompt`/`--settings` flag, since the contract and hooks reach the agent by worktree
auto-discovery, see [[harness-delivery]]), the shared resolution of a raw `surface: command` invocation into
the prompt that [[launch]] or [[dispatch]] delivers, and the poll loop the watch/wait subscriptions
share. A launch record carries the selected launcher name, its resolved harness, and the exact pinned
`launch_cmd`; session lifecycle and comms call that one interactive adapter directly rather than routing on a
second product dimension. The session's node is derived only from the raw prompt's first `[[id]]` topic
mention ([[mentions]]) — no caller-supplied node argument exists at the CLI, HTTP, or function boundary.
That one visible mention drives the record attribution and the node part of the branch/worktree slug; without
one the session stays node-agnostic and falls through to its prompt-derived title. The branch/worktree slug
and that title are the session's OWN identity: derivation strips actor mentions (`@session`, [[mentions]]) and
UUID-shaped tokens first — a prompt that mentions another session must never name this one after it, or a
worker sent to clean that session can match its own worktree — and the slug keeps unicode letters/numbers,
so a CJK prompt survives as the readable name its author typed (git refs take unicode; transliteration
would trade that for a dependency and a name nobody wrote). Worst case the slug falls back to `session`,
kept unique by the session short-id suffix. Worktree
prep also copies the machine-local `spexcode.local.json` snapshot from the main checkout into every fresh
session worktree — the one source git cannot deliver, since the tracked spec data arrives by checkout and
the materialized artifacts by re-materialize (the transport-by-kind policy and its helper module belong
to [[residence]];
here it is the one call after `worktree add`). The
session objects it assembles carry their display strings pre-derived (`label`/`headline`) and hide the
bare name parts under `raw` — that naming seam's contract (chains, wire shape, enforcement) is
[[session-label]]'s. Cross-feature defaults that must be read by the backend at runtime live here as the
shared implementation seam — for example [[launch]]'s `sessions.maxActive` fallback value — while the feature
node still owns the user-facing policy and slot semantics. Each session feature ([[state]], [[launch]], [[dispatch]], [[comms-edge]], [[session-edges]],
[[session-selectors]], [[agent-reply-channel]], [[spec-pointer]]) specializes a slice of it and lists it
under `related:`, so a change here attributes its drift and eval staleness to this one owner instead of all of them
(see [[governed-related]]). That several features hold no code of their own is the honest signal that
`sessions.ts` is a monolith — a future code split into per-feature modules would let each reclaim ownership.

### Record integrity — one writer, three readings, no revival

**Every field of `session.json` is produced by ONE writer here**, by serializing the typed record and landing
it by atomic replace, and NOTHING else may compose or edit that file's text — not a hook, not a shell, not a
route. The reason is the `note`: it is arbitrary human/agent prose, so any writer that substitutes it into
existing JSON eventually meets a quote, a backslash, or a newline and leaves a record nothing can parse. Both
note-carrying entries — the agent's typed declaration and the hook's capture of an asked question — therefore
land through the same call, and a note round-trips byte-for-byte on every surface. The shell hooks keep the
cheap half: the one-field-per-line shape lets them READ ("already active, nothing stale to clear?") with
exact-line greps and no jq, and every WRITE goes back through the CLI to this writer ([[state]]).

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
put it back to `active`/`idle`, no launch is assembled for it, only `close` remains.

A launch is likewise refused **before** a window opens when the transport can already settle it: no worktree,
no branch, no resolvable launcher command. Those are facts about this machine that no number of attempts can
change, so each is one loud refusal carrying its own code — never a launch that fast-exits and is retried on a
wall clock ([[launch]]). What the transport cannot settle stays with the bounded readiness retry, and what only
the harness can recognize is the harness's to declare ([[harness-adapter]]).
