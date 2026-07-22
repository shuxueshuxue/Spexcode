---
title: sessions-core
status: active
hue: 280
desc: The shared session module every session feature builds on — the global per-session record I/O, worktree/branch/node resolution, and the launch/state/dispatch/poll plumbing the lifecycle and comms nodes each specialize.
code:
  - spec-cli/src/sessions.ts
related:
  - spec-cli/src/sessionSlug.test.ts
---
# sessions-core

## raw source

The session subsystem's features — lifecycle state, launch, dispatch, comms, the live graph, selectors,
the spec-pointer — all read and write ONE module, `sessions.ts`. It is shared substrate with no single
feature as its owner, so per-feature drift on it fanned the same change across a dozen nodes. Give it a
foundation owner: the features govern their own surfaces and REFERENCE this module via `related:`.

## expanded spec

sessions-core owns `sessions.ts` — the common session layer: the global per-session record read/write
(`session.json` keyed by session_id, [[runtime]]), session↔worktree↔node resolution, the launch-script
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
