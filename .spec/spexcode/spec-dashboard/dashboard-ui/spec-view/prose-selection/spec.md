---
title: prose-selection
status: active
hue: 198
desc: A text selection in the rendered spec prose, resolved back to a line range of the node's spec.md body.
code:
  - spec-dashboard/src/proseSelection.js
related:
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/proseSelection.test.mjs
---
# prose-selection

## raw source

Selecting a sentence in a spec should be enough to act on it. For that, the board has to know **which
lines of the file** the reader just picked — and rendered prose does not say.

## expanded spec

**Why the DOM cannot be read backwards.** The prose renderer ([[node-popup]]'s `SpecBody`) is lossy on
purpose: a paragraph's source lines are joined with spaces, heading and list markers are eaten, blank lines
vanish, and inline markup is replaced by what it means. Nothing in the rendered text lets a reader's
selection be measured back into a line number. Searching for the selected string in the file would be a
guess dressed as an answer — it breaks on the first re-flowed paragraph and on any passage that appears
twice.

**So the renderer says where each block came from.** The tokenizer already walks the source line by line,
so every block it emits is STAMPED with the body lines that produced it (`data-l0`/`data-l1`, 1-based
inclusive), and this module reads those stamps back. One bridge, no second tokenizer, and no possibility of
the renderer and the reader disagreeing about which lines a block is.

**The smallest addressable region is the smallest thing the renderer can name.** A list stamps both the
list and each item, so a selection resolves to the DEEPEST stamped elements it touches — otherwise picking
one bullet would round up to the whole list. Blocks the selection spans are unioned into one range.

**Where a stamp cannot be vouched for, there is no selection.** A part (`## raw source` / `## expanded
spec`) is a slice of the body with its heading removed, so its blocks must be numbered against the WHOLE
body or a manual edit would put lines back in the wrong place. This module locates the slice and then
VERIFIES the placement reproduces the part text; an unplaceable part renders exactly as before, simply
unstamped, and the actions stay off for it. The same rule covers prose outside the body — a title, the meta
row, an issue body rendered through the same component: unstamped means no line numbers, and no line
numbers means no action. Silence, never a guessed range.

**What travels is bytes from the file.** Every downstream use — the prompt token, the region a manual edit
replaces — is sliced out of the BODY TEXT by those line numbers, never lifted from the DOM. That is what
makes a passage lossless in transit and what lets [[spec-body-edit]] compare a region it is asked to
replace against the region that is there.

**The payload is [[code-selection]]'s, plus the node.** A prose selection carries the same `path`,
`startLine`, `endLine`, `text` a source selection carries, and adds the node id — because a spec body is
addressed by node (the address a reader resolves as `[[id]]`), while a source file is addressed by path.
No second token format, no second transport.
