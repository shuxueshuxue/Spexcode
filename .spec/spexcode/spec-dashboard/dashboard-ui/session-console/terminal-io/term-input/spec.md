---
title: term-input
status: active
session: sess-cmdline
hue: 290
desc: The command line lives outside xterm, so the arrow keys are ours.
---
# term-input

A live terminal swallows every keystroke — including the arrows we navigate the tree with. So the
command line lives **outside** xterm: the terminal is a **read-only display**, and a **separate input
owns the keys**. Because the input is ours, an arrow can mean two things — **navigate** when the line is
empty, **edit** when it isn't. Empty is the signal. This is the whole node: a cross-cutting contract,
realised wherever a live terminal sits beside spec navigation.

## the input owns its keys

- **Empty-line arrows navigate; text-present arrows edit.** With the line empty, `←`/`→` walk
  parent/child and `↑`/`↓` walk the column (the same nav the graph uses — see [[keyboard-nav]]); with
  text present the arrows walk the caret and stop there, so nothing double-fires. List nav is lifted to
  the **window** level so it survives xterm focus — the keys are ours, not xterm's.
- **Dispatch goes through the control socket, never the pane.** A running session's message is injected
  out-of-band (the rendezvous control socket, bypassing tmux), so it lands even when scrolling has put
  tmux in copy-mode — where bytes written into the pane are eaten as navigation and never reach the
  agent. Dispatch is **fail-loud**: a failed send restores the draft and flags the error rather than
  pretend it sent. A **set of `/` commands never reaches the agent** — the *board* commands, handled by
  the dashboard itself: `/exit` stops the session but **keeps** its worktree (it goes offline, resumable),
  `/close` removes the worktree (the no-prompt discard), `/merge` merges it, `/nav` toggles nav mode, `/eval`
  opens the Eval tab. Each is the **typed twin of a header button** — drawn from
  **one registry**, so the command and its button are one action, one identity colour, and can never
  drift. Sending these words to a live agent would only drive the agent's own process, not the board.
  Realised in [[session-console]].

## completion menus answer different questions

A leading token opens a dropdown. For **authoring** rows — `[[` nodes, config presets, Claude Code's
own commands — a row **only ever inserts its token text** and **never runs anything**; they are authoring
aids, not a second control plane. The **one exception** is a **board command** (below): its row is the
typed twin of a header button, so accepting it **runs the action** — it *is* the board's control plane,
not a hint toward one.

- **`[[` — spec nodes (a topic), on every prompt.** Which node does this target? Typing `[[` opens the
  node dropdown (the focused node leads it, the convenient default); accepting inserts `[[<id>]]`. It is the
  **same** dropdown on the New Session prompt and on a running session's `❯` inbox — one menu, not two.
- **`@` — sessions (an actor), on every prompt.** Typing `@` opens a parallel dropdown of the **live** board
  sessions plus **`@new`** (spawn a fresh worker), ranked by relevance; accepting inserts `@<id>`. This is
  the [[mentions]] grammar: `[[node]]` names a topic, `@session` names an actor — the two never collide. In
  the composer/inbox the token expands to prompt text (the agent reads it); only in an issue thread does `@` also
  programmatically dispatch.
- **`/` on the New Session prompt — the config presets** (our own bespoke preset set), *not* Claude
  Code's palette.
- **`/` on a running session's `❯` inbox — the board commands, then Claude Code's own `/` menu.** The
  board's own commands (`/exit`·`/close`·`/merge`·`/nav`·`/eval`) **lead** the list, each in its **identity
  colour** with a `[board]` tag, visibly apart from CC's blue command rows below — because there you talk
  to a live agent (CC commands make sense), but the board commands act HERE on the dashboard.

## the New Session `/` composes at launch

The dropdown stays decoupled: picking a preset only inserts `/<name> `. The body is woven in only at
**Enter**. The grammar `/<preset> [[node]]… <free text>` assembles **one** prompt — the preset's body
with its targets placeholder filled by the `[[…]]`-resolved nodes, then the free text appended. No node ref
leaves a "current/focused node" note for the body to handle. A leading `/` naming no known preset, and
any plain or node-only prompt, launch verbatim — the existing paths are untouched.

## the running session's `[[node]]` resolves at send

The same authoring aid, mirrored into the live conversation. A `[[node]]` typed into a running session's
`❯` inbox is **resolved at send-time** — each token expands in place to its node id plus a pointer to that
node's live `spec.md` path, so the driven agent is aimed at the node's current contract and reads the file
itself, never a pasted body. This is the in-conversation twin of [[spec-pointer]]'s launch pointer: New
Session resolves `[[node]]` at Enter into the launch prompt; a running session resolves it at send into the
keyed message. An unknown id passes through untouched, and the rest of the line is sent verbatim — the node
ref is the only thing rewritten.

## no source of its own

This node is the cross-cutting *contract*, so it governs no files directly; the realisations live where
other nodes own them — the docked terminal, input, and `/`·`@` menus in `SessionInterface.jsx`
([[session-console]]); the capture-phase arrow routing in `App.jsx` ([[keyboard-nav]]); and the
CC-command union plus config presets in [[spec-cli]]. A change to any of those is that surface's
drift, not a phantom warning here. (The in-popup original of this contract, `TermPane.jsx` under a
`session-peek` node, was a dormant mock and has been removed — the principle lives on in the console.)
