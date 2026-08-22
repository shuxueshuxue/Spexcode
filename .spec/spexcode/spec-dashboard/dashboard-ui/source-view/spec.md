---
title: source-view
status: active
hue: 200
desc: The read-only face of a governed source file — a virtualising editor component over [[source-read]]'s windows, wired to the board's own palette.
code:
  - spec-dashboard/src/SourceView.jsx
related:
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
scroll position and selection survive the append. The footer states the file's real size and, while windows
remain, how much of it has arrived — a partially loaded file must never read as a complete short one. A
refused or failed read replaces that meter with the reason.

**The palette comes from the board, not from the component.** Every colour is a CSS custom property the rest
of the dashboard already defines, so the viewer re-themes with all seven themes for free. This is the
opposite of the node status dots, which pinned one theme's hexes inline and therefore stay dark-theme
coloured on a light theme; the mistake is cheap to avoid at the start and awkward to undo later.

**A language pack is loaded on demand and its absence is not a failure.** Highlighting is fetched per file
extension as a separate chunk, so opening a plain-text file never pays for a parser, and an unrecognised
extension simply reads unhighlighted. Bytes appearing is the contract; colour is an improvement on it, so a
language that fails to load must never block the file from showing.
