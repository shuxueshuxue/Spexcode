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
  pretend it sent. One token never reaches the agent: **`/exit` alone is intercepted** as a *dashboard*
  command — it closes the session (the no-prompt removal) rather than being dispatched, since sending the
  word to a live agent would only quit its own process and orphan the worktree. Realised in [[session-console]].

## completion menus answer different questions

A leading character opens a dropdown. A row **only ever inserts its token text** and **never runs
anything** — these are authoring aids, not a second control plane over the session.

- **`@` — spec nodes.** Which node does this target? The focused node is the first suggestion, so just
  typing `@` opts into it.
- **`/` on the New Session prompt — the config presets** (our own bespoke preset set), *not* Claude
  Code's palette.
- **`/` on a running session's `❯` inbox — Claude Code's own `/` menu**, because there you are talking
  to a live agent, where CC commands make sense.

## the New Session `/` composes at launch

The dropdown stays decoupled: picking a preset only inserts `/<name> `. The body is woven in only at
**Enter**. The grammar `/<preset> @<node>… <free text>` assembles **one** prompt — the preset's body
with its targets placeholder filled by the `@`-resolved nodes, then the free text appended. No `@`
leaves a "current/focused node" note for the body to handle. A leading `/` naming no known preset, and
any plain or `@`-only prompt, launch verbatim — the existing paths are untouched.

## no source of its own

This node is the cross-cutting *contract*, so it governs no files directly; the realisations live where
other nodes own them — the docked terminal, input, and `/`·`@` menus in `SessionInterface.jsx`
([[session-console]]); the dormant in-popup original `TermPane.jsx` ([[session-peek]]); the
capture-phase arrow routing in `App.jsx` ([[keyboard-nav]]); and the CC-command union plus config
presets in [[spec-cli]]. A change to any of those is that surface's drift, not a phantom warning here.
The realisation moved surfaces; the principle — input outside xterm so arrows can navigate — did not.
