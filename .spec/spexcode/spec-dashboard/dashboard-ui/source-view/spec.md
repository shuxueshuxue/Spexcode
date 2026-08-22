---
title: source-view
status: active
hue: 200
desc: The read-only face of a governed source file — a virtualising editor component over [[source-read]]'s windows, wired to the board's own palette.
code:
  - spec-dashboard/src/SourceView.jsx
related:
  - spec-dashboard/src/codeSelection.js
  - spec-dashboard/src/codeSelection.test.mjs
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/data.js
  - spec-dashboard/src/styles.css
---
# source-view

The component that renders a governed file. It pulls [[source-read]]'s windows and shows them; it cannot
write.

**Why an editor engine for a read-only view.** Because virtualisation is the whole problem and nothing else
solves it. Measured: CodeMirror renders a 200,000-line document in about 30 ms with roughly 86 DOM nodes,
while a span-per-token renderer needs seconds and six figures of nodes at a twentieth of that size — the
difference is structural, not tuning, because only one of the two renders the viewport instead of the
document. A token-per-span highlighter remains the right tool for a markdown code fence, where the snippet
is short and the surrounding prose is already HTML; it is the wrong tool for a file.

**Read-only is a product decision, not a missing feature.** No editing surface exists on the board. A
governed file changes through a session, which holds a worktree and a commit, so a text box here would race
the agent holding the same file and would land writes that no `Session:` trailer explains. The same reason
`main-guard` exists.

**Loading is incremental and never yanks the reader.** The first window paints; further windows are appended
as a plain transaction at the document end when the reader scrolls near the bottom of what is loaded, so
scroll position and selection survive the append.

**The viewer shows the file and says nothing about the file.** Its path is already the address, the tab and
the chip that opened it; a strip repeating it was a fourth copy and a chrome band ([[ui-state-model]]) to
hold it. What is not said anywhere else is whether the read has finished — a partially loaded file must
never read as a complete short one — so that, and only that, floats over the text as a small progress mark
while it is still true and leaves when it stops being news. A refused or failed read shows the reason in
the same place and keeps it.

The reader also exposes a selection event for a non-empty CodeMirror selection. A small action affordance
may call the parent with `{ path, startLine, endLine, text }`; the viewer owns neither the prompt nor any
dispatch. The parent routes that context into the ordinary New Session composer, because New is the existing
long-form, explicit-launch surface while Command Box is an immediate message to an already selected session.
The composer encodes the context as a human-readable, parseable prompt token, renders it back as a removable
attachment chip, and leaves the surrounding prompt editable. Selecting code never launches by itself, and the
viewer remains read-only: it does not write the file, create a session, or call an API beyond its existing
window reads.

**The palette comes from the board, not from the component.** Every colour is a CSS custom property the rest
of the dashboard already defines, so the viewer re-themes with all seven themes for free. This is the
opposite of the node status dots, which pinned one theme's hexes inline and therefore stay dark-theme
coloured on a light theme; the mistake is cheap to avoid at the start and awkward to undo later.

**A language pack is loaded on demand and its absence is not a failure.** Highlighting is fetched per file
extension as a separate chunk, so opening a plain-text file never pays for a parser, and an unrecognised
extension simply reads unhighlighted. Bytes appearing is the contract; colour is an improvement on it, so a
language that fails to load must never block the file from showing.
