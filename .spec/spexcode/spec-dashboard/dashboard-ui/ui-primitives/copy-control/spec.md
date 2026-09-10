---
title: copy-control
status: active
hue: 150
desc: The one copy control — a quiet square that takes a whole thing (a code block, a message) as its authored source, through one clipboard seam, and answers on itself whether it worked.
code:
  - spec-dashboard/src/CopyButton.jsx
related:
  - spec-dashboard/src/clipboard.js
  - spec-dashboard/src/Root.jsx
  - spec-dashboard/src/Prose.js
  - spec-dashboard/src/TimelineChat.jsx
  - spec-dashboard/src/Transcript.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/i18n/en.js
  - spec-dashboard/src/i18n/zh.js
  - packages/transcript-ui/src/context.tsx
  - packages/transcript-ui/styles.css
---
# copy-control

## raw source

The timeline and every rendered Markdown surface have no way to take a code block with one press, and no
place to copy a note or an agent's reply whole. Selecting by hand is the only road, and it is the wrong one:
a selection copies what was painted, a long note is clamped, and a code block is exactly the thing a reader
wants verbatim.

## expanded spec

**One press takes the whole thing, as it was written.** A code block copies its source; a message copies the
Markdown its author wrote — never the rendered DOM, never a clamped face, never a formula's two branches. A
code block's copy leaves out the block's own closing newline and nothing else, because pasted into a shell
that newline would run the command before the reader has looked at it; an authored blank line inside the
block stays.

**One control, one seam.** `CopyButton` is the only copy control a surface mounts: an icon-only square with
an accessible name that says what it copies (`copy code`, `copy message`) and a tooltip carrying the same
words ([[icon-system]], [[tooltip]]). It writes through the one clipboard seam (`writeClipboard`) that the
conversation's own selection copy also uses ([[conversation]]): the Clipboard API when the page has it,
otherwise the browser's synchronous copy command from the same press, with the payload written by a one-shot
`copy` event. That fallback creates no textarea, no document Selection, and no focus handoff, so it works on
a plain-HTTP dashboard (where the Clipboard API does not exist) without disturbing a composer caret or a
painted selection. Success means the API resolved, or the command returned true AND the event accepted the
text; anything else is a failure.

**The answer is on the button the reader pressed.** Success turns the glyph into a check that fades back after
a moment. Failure turns it into a cross, renames the control `copy failed`, and stays — visible even when the
pointer has left — until the next press, because a copy that silently did nothing is the one outcome a reader
cannot notice by themselves. A press never takes focus (the conversation's composer keeps its caret) and
never reaches the block around it: a press on a code block's control inside a clamped note copies the code and
leaves the note clamped.

**The control is shown by what it copies.** It rests hidden and appears while the thing it copies is pointed
at or holds keyboard focus; where nothing can point (`hover: none`, a phone) it is simply there, and so it
may never sit over words — a code block keeps its corner clear of code and an agent turn drops its control to
its own line under the text. Where it sits is the host's grammar, not this node's: a code block wears it in
its top-right corner ([[prose-renderer]]); the conversation puts a note's at its head's far end, an event's at
its line's end, a quoted message's beside its bubble, and an agent turn's in the turn's corner through the
transcript package's `renderCopy` slot ([[conversation]], [[transcript-ui]]).

**The prose renderer places it, the root supplies it.** The renderer stays loadable where the app's icons and
words are not (a node test renders it bare), so it never imports the control: the root mounts it once through
`CodeCopyContext` ([[light-entry]]), every prose surface below inherits it, and a bare render simply has no
control. No surface opts in, and none can forget to.

Other places that copy — an address from a context menu, a terminal selection, a session file's path — still
reach the clipboard through their own paths; this seam is where they belong when they are next touched.
