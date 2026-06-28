---
title: sessions-core
status: active
hue: 280
desc: The shared session module every session feature builds on — the global per-session record I/O, worktree/branch/node resolution, and the launch/state/dispatch/poll plumbing the lifecycle and comms nodes each specialize.
code:
  - spec-cli/src/sessions.ts
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
auto-discovery, see [[harness-delivery]]), and the poll loop the watch/wait subscriptions share. Each session feature ([[state]], [[launch]], [[dispatch]], [[comms-edge]], [[graph]],
[[session-selectors]], [[agent-reply-channel]], [[spec-pointer]]) specializes a slice of it and lists it
under `related:`, so a change here attributes its drift/yatsu to this one owner instead of all of them
(see [[governed-related]]). That several features hold no code of their own is the honest signal that
`sessions.ts` is a monolith — a future code split into per-feature modules would let each reclaim ownership.
