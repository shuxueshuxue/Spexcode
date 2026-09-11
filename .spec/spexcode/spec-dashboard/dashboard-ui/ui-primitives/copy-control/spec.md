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
at or holds keyboard focus; while hidden it takes no pointer, so wherever it rests stays the reader's. Where
nothing can point (`hover: none`, a phone) it is simply there, and so it may never sit over words — a code block
keeps its corner clear of code, and a message's control takes its own line under the message.

**A code block's control is top-right; a message's is bottom-right.** A code block is read as an object, and its
control sits in its top-right corner ([[prose-renderer]]). A message is read to its end, and its control sits at
its bottom-right, where the reader finishes: the conversation hangs a note's, an event's and a quoted message's
just under the message's bottom-right corner, in the empty space between rows, so it adds no height and covers
no word ([[conversation]]); an agent turn inside a transcript keeps its control inside the text's bottom-right
corner — where a paragraph's last line is usually short — because right under a turn's text is often its first
tool call, whose chevron sits at the far right ([[transcript-view]], through the package's `renderCopy` slot). The
two corners are what keep a message that opens or ends on a code block from stacking two controls; a turn that
ends on a one-line code block moves its own control one control-width left of the block's.

**The prose renderer places it, the root supplies it.** The renderer stays loadable where the app's icons and
words are not (a node test renders it bare), so it never imports the control: the root mounts it once through
`CodeCopyContext` ([[light-entry]]), every prose surface below inherits it, and a bare render simply has no
control. No surface opts in, and none can forget to.

Other places that copy — an address from a context menu, a terminal selection, a session file's path — still
reach the clipboard through their own paths; this seam is where they belong when they are next touched.
