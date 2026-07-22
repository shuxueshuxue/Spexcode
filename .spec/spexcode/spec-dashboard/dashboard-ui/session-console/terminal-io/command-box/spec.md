---
title: command-box
status: active
hue: 290
desc: Cmd/Alt+I opens a lower-middle command surface for out-of-band prompts, board verbs, mentions, presets, and file paths.
related:
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/Composer.jsx
  - spec-dashboard/src/sessionCommands.js
  - spec-dashboard/src/mentions.jsx
  - spec-dashboard/src/textarea.js
  - spec-dashboard/src/styles.css
  - spec-dashboard/test/command-box.e2e.mjs
---

# command-box

The dashboard's authored control channel is a **Command Box**, not a second terminal input. The name states
why it exists: this is where a human addresses SpexCode's board and sends an atomic out-of-band prompt, while
the agent's own TUI remains the default place to converse and drive interactive menus ([[terminal-input]]).

The reserved single-modifier chord `Cmd+I` or `Alt+I` toggles it for a live session; `Alt+Cmd+I` remains the
browser's developer-tools chord. The toolbar exposes the same action as an icon-only button named by its
tooltip and accessible label. Opening focuses the Command Box. Escape or an outside click closes it without
discarding the draft, and focus returns to the TUI. Drafts are keyed by session and survive closing, routing
away, and switching sessions. Vim behavior is deliberately outside the current contract.

The box floats in the terminal's **lower middle**, horizontally centered. Its bottom edge is fixed at about
64% of the terminal pane's height: low enough to feel near the working prompt, with enough room below to keep
the surrounding TUI visible. It does not reserve layout or resize xterm. Its width is bounded for scanning and
shrinks with the pane. The shared [[composer]] footer stays on that fixed bottom edge while textarea content
grows upward to a bounded cap; the box never walks toward the screen bottom or top as lines are added. Menus
open above the caret/footer inside the available upper space. At phone width the desktop Command Box does not
replace [[mobile-ui]]'s existing composer.

Sending uses the session's control socket, never PTY typing, so one authored prompt lands atomically even while
the terminal is in copy mode. A successful send clears the draft and closes the box. A failed send leaves it
open, restores the draft, and shows the error. Enter sends only when it is not committing an IME composition;
Shift+Enter adds a line. The box uses the one shared [[composer]] shell also used by Issues and Evals.

Its grammar is the old control plane, kept in one place: `[[node]]` resolves at send to the node id plus its
live `spec.md` pointer; `@session` and `@new` use [[mentions]]; `/` lists available board commands first,
then command presets, then harness commands. Board rows execute locally from the same registry as toolbar
twins; authoring rows insert text. `/stop`, `/close`, `/merge`, and `/eval` retain their existing meaning.
There is no `/type`: direct TUI input is already the default. File paste, drop, and pick reuse [[file-attach]],
uploading bytes to the worker machine and inserting the returned local path at the caret.
