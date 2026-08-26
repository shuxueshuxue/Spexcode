---
title: command-box
status: active
hue: 290
desc: Alt+I opens a lower-middle command surface for out-of-band prompts, board verbs, mentions, presets, and file paths.
related:
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/Composer.jsx
  - spec-dashboard/src/sessionCommands.js
  - spec-dashboard/src/mentions.jsx
  - spec-dashboard/src/textarea.js
  - spec-dashboard/src/styles.css
  - spec-dashboard/test/command-box.e2e.mjs
  - spec-dashboard/test/command-box-new.e2e.mjs
---

# command-box

The dashboard's authored control channel is a **Command Box**, not a second terminal input. The name states
why it exists: this is where a human addresses SpexCode's board and appends an out-of-band prompt, while
the agent's own TUI remains the default place to converse and drive interactive menus ([[terminal-input]]).

The reserved single-modifier chord `Alt+I` toggles it for a live session; Command/Ctrl+I remain native or
browser-owned shortcuts. The toolbar exposes the same action as an icon-only button named by its tooltip and
accessible label. Opening focuses the Command Box. Escape or an outside click closes it without
discarding the draft, and focus returns to the TUI. Drafts are keyed by session and survive closing, routing
away, and switching sessions. Vim behavior is deliberately outside the current contract.

The box floats in the terminal's **lower middle**, horizontally centered. Its bottom edge is fixed at about
78% of the terminal pane's height: low enough to feel near the working prompt, with enough room below to keep
the surrounding TUI visible. It does not reserve layout or resize xterm. Its width is bounded for scanning and
shrinks with the pane. The shared [[composer]] footer stays on that fixed bottom edge while textarea content
grows upward to a bounded cap; the box never walks toward the screen bottom or top as lines are added. Menus
open above the caret/footer inside the available upper space. At phone width the desktop Command Box does not
replace [[mobile-ui]]'s existing composer.

Sending appends the prompt to the selected session's durable log ([[dispatch]]), so one authored prompt lands
atomically even while the terminal is in copy mode. `@session` remains a passive [[mentions]] reference, while
`@new` creates a worker whose durable parent is that selected session's exact id and `@new:<launcher>` changes
only that child's launcher. The appended prompt and any creation receipt are one command submission: a child
creation failure is visible while the already-appended prompt remains delivered. The box owns the right-pane
in-flight action state; settled success and failure messages publish through the shared transient-notice
surface, so a child receipt remains inspectable after the box closes. A refused delivery retains the complete
draft and returned HTTP/body error, and therefore stays ready for retry. Each authored draft carries one opaque
delivery key while it is pending; a retry with that key addresses the existing durable queue entry and cannot
append a duplicate. A response that reports a MEASURED unfinished handover — the adapter was asked and still
owes the prompt — keeps the draft and reports a retry-safe queued warning. **Durable acceptance is itself a
success and clears the draft**, including the ordinary deferred-handover path where the backend answers before
starting the handoff: the durable queue is the delivery guarantee, and the supervisor owns the retry, so holding
a second copy of an accepted prompt in this textarea protects nothing while costing a false transport warning on
every send. The box always publishes a success notice; disappearing is never the only success signal. A close, session switch, or the next send owns clearing the in-flight state; the session list
never mirrors it. Enter sends only when it is not
committing an IME composition; Shift+Enter adds a line. The box uses the one shared [[composer]] shell also used
by Issues and Evals.

Its grammar is the old control plane, kept in one place: `[[node]]` resolves at send to the node id plus its
live `spec.md` pointer; `@session` and `@new` use [[mentions]]; `/` lists available board commands first,
then command presets, then harness commands. Board rows execute locally from the same registry as toolbar
twins; authoring rows insert text. `/stop`, `/close`, and `/eval` retain their dashboard meaning. `/merge`
is the [[merge]] plugin preset: the box sends its resolved workflow to the agent, and the agent performs the
landing with the same on-demand skill available to self-launched sessions. It has no toolbar twin.
There is no `/type`: direct TUI input is already the default. File paste, drop, and pick reuse [[file-attach]],
uploading bytes to the worker machine and inserting the returned local path at the caret.

## delivery deadline and menu precedence

The HTTP request has one named transport deadline; if the response is not confirmed by then, the
draft and delivery key stay in place and the outcome says delivery is unconfirmed and retry is safe. This deadline
does not write or infer lifecycle state.

Board commands lead the menu tagged `[ui]` and run on acceptance; live command presets
tagged `[preset]` and harness commands follow as authoring rows that insert their token. Names deduplicate by
that precedence.
