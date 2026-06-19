---
title: spec-node-states
status: active
hue: 50
desc: A node's status is a backend-DERIVED four-state value (pending/active/merged/drift), not hand-written.
---
# spec-node-states

A spec node's `status` is no longer hand-typed in frontmatter — it is **derived in the backend**
from what git and the live worktrees actually say. There are exactly four states, evaluated in this
precedence (`deriveStatus` in [[source-of-truth]]'s `specs.ts`):

- **active** — an unmerged managed worktree has pending ops on this node (it carries a board
  *overlay*). This is live, in-flight work, so it wins over the others. Only the board assembler
  knows the overlay, so this state can only be produced there.
- **drift** — the governed code has moved ahead of the spec's latest version (`drift > 0`, by git
  ancestry). The spec may be stale.
- **merged** — the node has committed version(s) and is in sync (no drift, no in-flight work).
- **pending** — no committed version yet (`version === 0`).

Frontmatter `status` survives only as a **fallback**: if git is unreadable every node would collapse
to version 0 / pending, so a node that *declared* a status still shows that intent. Otherwise the
declared value is ignored — the derivation is authoritative.

Because `active` needs the overlay, the derivation runs in two places over one shared helper:
`loadSpecs` derives from git alone (so `/api/specs` reports pending/drift/merged), and `buildBoard`
([[sessions]]) re-derives **with** the overlay so a node a worktree is touching reads `active`. A
ghost node (one a worktree is *adding*, not yet on main) therefore reads `active`, never `pending`.

The same end-to-end tracing covers the two other state vocabularies the board shows:

- **overlay op-types** — `added` · `edited` · `deleted` · `moved`, computed per worktree vs main and
  stamped on the node as glyphs (`+ ~ ✕ →`) in the colour of the authoring session (see
  [[node-graph]] for the surfacing).
- **session states** — the worktree state machine, traced **HARD** (explicit writes, then one liveness
  check + one guarded inference — no text-sniffing the TUI). The agent's own writes are authoritative and
  `reconcile` returns each directly: `awaiting`'s proposals `review` · `done` · `close-pending`, plus
  `blocked` · `error` · `needs-input`. `needs-input` is captured **deterministically** the instant the
  agent invokes the **AskUserQuestion** tool — the single `PreToolUse` mark-active hook reads `tool_name`
  from the payload and writes `needs-input` (the question → note), else `active` — and is also
  self-declarable via `spex session ask`. The only LIVE-derived values are `working` · `idle` · `offline`,
  from **one** liveness check (a dead tmux or a bare-shell pane = offline) plus **one** guarded inference
  (`idle`, written active-only by the `idle_prompt` Notification hook so it never clobbers a declaration).
  Each is carried straight to the session window's status dot (see [[sessions]] and [[session-console]]).

The dashboard surfaces the derived node status as the row's dot colour and label
(green=merged, orange=active, yellow=drift, grey=pending), with the drift count still shown as its
own badge — see [[node-graph]].
