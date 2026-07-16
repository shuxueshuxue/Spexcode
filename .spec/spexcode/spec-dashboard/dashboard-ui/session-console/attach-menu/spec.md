---
title: attach-menu
status: active
hue: 190
desc: Right-click → "attach" hands over the `spex session attach <id>` command, so a human can join a live session's real tmux from a shell on the host.
code:
  - spec-dashboard/src/SessionAttach.jsx#SessionAttach
related:
  - spec-dashboard/src/SessionContextMenu.jsx
  - spec-dashboard/src/styles.css
---

# attach-menu

## raw source

The console's terminal ([[session-console]]) is a **read-only** view over a session's pane — a real tmux
client but with input disabled. Sometimes a human wants the genuine thing: a full tmux client attached from
a shell on the host, with their own input and scrollback, to drive the agent directly or watch it outside the
browser. The CLI already exposes that escape hatch — `spex session attach <SEL>` ([[session-attach]]) — but a
human at the dashboard had to leave it, remember the verb, and retype the id. So the session row's right-click
menu ([[session-rename]]) grows a verb, **attach**, that hands over the ready-to-paste command.

## expanded spec

**Attach** is a context-menu verb beside rename, select, and close ([[session-rename]], [[session-multi-select]]).
Picking it swaps the menu for a small modal (the shared rename-modal chrome) that **titles itself with the
session's headline** — the same words its row shows ([[session-activity]]) — and shows one line: the exact
command **`spex session attach <id>`** for the right-clicked row. It hands over the project's OWN blessed
attach verb ([[session-attach]]), never the raw `tmux -L <socket> attach` incantation that the CLI verb exists
precisely to save humans from — so when the human runs it they inherit that verb's detach hint, locality
guard, and offline-loud behaviour for free, and the dashboard hardcodes no tmux socket.

The command sits in a **read-only, monospace, click-to-select** field beside a **copy** button. Copy writes it
to the clipboard when the Clipboard API is available and flips the button to a "copied" acknowledgement; where
that API is absent (a non-secure context), the selectable field is the fallback — the human selects and copies
by hand, so the modal is never a dead end. The modal is **informational only**: it runs nothing (the web page
can't foreground-attach a terminal for the human), mutates no session, and closes on the shared close button,
a backdrop click, or Escape (its own [[esc-layers]] layer).

Attach is offered **only when a live tmux window exists to join** — the row's liveness is not `offline` and it
is not `queued` (which has intentionally not launched, so it has no tmux yet). An `offline`/`queued` row shows
no attach item, matching the CLI verb's own offline-loud stance: there would be nothing for the pasted command
to attach to. The verb is read-only and non-destructive, so unlike close it needs no confirm.

This node owns only the attach modal (`SessionAttach.jsx`); the menu item that opens it is a one-line hook in
[[session-rename]]'s `SessionContextMenu`, and the `.sess-attach-*` styling is its slice of `styles.css`.
