---
title: attach-menu
status: active
hue: 190
desc: Right-click → "attach" hands over the attach command — the blessed `spex session attach` verb and the raw `tmux` fallback — so a human can join a live session's real tmux from a shell on the host.
code:
  - spec-dashboard/src/SessionAttach.jsx#SessionAttach
related:
  - spec-dashboard/src/SessionContextMenu.jsx
  - spec-cli/src/index.ts
  - spec-cli/src/sessions.ts
  - spec-dashboard/src/styles.css
---

# attach-menu

## raw source

The console's terminal ([[session-console]]) is a **read-only** view over a session's pane — a real tmux
client but with input disabled. Sometimes a human wants the genuine thing: a full tmux client attached from
a shell on the host, with their own input and scrollback, to drive the agent directly or watch it outside the
browser. The CLI already exposes that escape hatch — `spex session attach <SEL>` ([[session-attach]]) — but a
human at the dashboard had to leave it, remember the verb, and retype the id. So the session row's right-click
menu ([[session-rename]]) grows a verb, **attach**, that hands over the ready-to-paste command — both the spex
verb and the raw tmux form, since a shell without `spex` on PATH still has tmux.

## expanded spec

**Attach** is a context-menu verb beside rename, select, and close ([[session-rename]], [[session-multi-select]]).
Its menu **label reads "open in terminal…"**, not the bare word "attach": the concept is a tmux attach, but the
label must make sense to a human who has never touched tmux, so it says what the verb *does* — opens this
session in your own terminal — while the internal name (this node, the `startAttach` handler) stays "attach".
The trailing `…` marks that it opens a dialog rather than acting at once, matching "select…".

Picking it swaps the menu for a small modal (the shared rename-modal chrome) that **titles itself with the
session's headline** — the same words its row shows ([[session-activity]]) — and offers **two copyable forms of
the attach command** for the right-clicked row, so the human picks whichever their host shell can run. The
modal opens directly on those command rows, with no instructional lead-in above them:

- **`spex session attach <id>`** — the recommended, project-blessed verb ([[session-attach]]), which carries a
  detach hint, a locality guard, and offline-loud behaviour when run.
- **`tmux -L <socket> attach -t <id>`** — the raw fallback for a shell without `spex` on PATH, where `<socket>`
  is the backend's real `-L` label (`TMUX_SOCK`, env-overridable) published on `/api/settings` as `tmuxSocket`
  and fetched once by the menu (falling back to the built-in `spexcode` until it lands). The dashboard never
  hardcodes the socket, so the fallback names the SAME server the backend drives, on any deployment.

Each form sits in its own row — a caption, a **read-only, monospace, click-to-select** field, and its own
**copy** button. Copy writes that form to the clipboard when the Clipboard API is available and flips its button
to a "copied" acknowledgement; where that API is absent (a non-secure context), the selectable field is the
fallback — the human selects and copies by hand, so the modal is never a dead end. The modal is **informational
only**: it runs nothing (the web page can't foreground-attach a terminal for the human), mutates no session, and
closes on the shared close button, a backdrop click, or Escape (its own [[esc-layers]] layer).

Attach is offered **only when a live tmux window exists to join** — the row's liveness is not `offline` and it
is not `queued` (which has intentionally not launched, so it has no tmux yet). An `offline`/`queued` row shows
no attach item, matching the CLI verb's own offline-loud stance: there would be nothing for the pasted command
to attach to. The verb is read-only and non-destructive, so unlike close it needs no confirm.

This node owns only the attach modal (`SessionAttach.jsx`); the menu item that opens it is a one-line hook in
[[session-rename]]'s `SessionContextMenu`, the `tmuxSocket` field is its slice of the shared settings route
(`index.ts`, sourced from `sessions.ts`'s `TMUX_SOCK`), and the `.sess-attach-*` styling is its slice of `styles.css`.
