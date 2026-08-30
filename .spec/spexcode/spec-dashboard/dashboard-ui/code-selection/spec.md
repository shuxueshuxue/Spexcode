---
title: code-selection
status: active
hue: 205
desc: A lossless, readable prompt token for carrying a selected passage — from a source file, a spec body, or a conversation — through the ordinary composer.
code:
  - spec-dashboard/src/codeSelection.js
related:
  - spec-dashboard/src/codeSelection.test.mjs
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/GraphView.jsx
---
# code-selection

The source viewer's parent may carry a non-empty selection into the ordinary New Session composer. The
selection is context, not an instruction and not an automatic launch. Its token is one HTML comment whose
JSON payload contains `path`, `startLine`, `endLine`, and the exact selected `text`; JSON escaping keeps
arbitrary source lossless while the visible metadata remains readable in a prompt transcript.

A selection from a spec node's **prose** ([[prose-selection]]) is the same token with one more field: the
node id — a spec body is addressed by node, the address its reader resolves as `[[id]]`, while a source file
is addressed by path. Both carry `path` regardless, so a token stays locatable without the board.

A passage quoted out of a **conversation** ([[conversation]]) is the same token again, and it is the one
flavour that carries neither: a timeline has no path and no line to point at, so it is addressed by the
`session` it was read in and the `at` of the row the passage started in. That is not a weaker address — a
conversation IS a time ruler, and when a thing was said is exactly how a reader on the other end finds it.
**What differs between the three is only what addresses the passage.** The comment, the lossless `text`, the
validator, the attachment row and the ordinary prompt are shared, which is what keeps a third reading surface
from growing a third dispatch route.

All three are read by the same validator, so a `node` that is present but empty is not an address and its
token is refused like any other malformed one, and so is an `at` that is not a time. **A token is ONE flavour
and never a blend**: `session` is the discriminator, and a token carrying both a session and a path is refused
rather than silently read as either — a reader that guessed would attribute a passage to a file it never came
from. The chip leads with whichever address names the thing: the node for prose, the path for source, the
session for a quote.

The composer parses valid tokens when a seeded prompt opens, renders each as a removable attachment chip,
and leaves the surrounding text as the human's editable intent. Submission serialises the chip(s) back into
the same prompt text and uses the existing `createSession` entry point. Malformed tokens remain visible text;
They are never silently discarded. No API route, session field, or alternate dispatch path belongs here —
a token sent to an ALREADY-RUNNING session ([[prose-dispatch]]) rides the ordinary session input route for
the same reason, as one more prompt rather than a channel of its own.

The visible chip is a compact attachment marker, not a second composer: one blue edge, one file-diff mark,
the address and inclusive line range, and one icon-only remove action. It uses the same quiet bordered
composer tokens as [[session-picker]] and stays readable when several selections wrap in the queue.
