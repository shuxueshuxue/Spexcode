---
title: code-selection
status: active
hue: 205
desc: A lossless, readable prompt token for carrying a governed source selection through the ordinary composer.
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
node id. That is the only thing the two flavours do not share, and it is not decoration — a spec body is
addressed by node, the address its reader resolves as `[[id]]`, while a source file is addressed by path.
Both carry `path` regardless, so a token stays locatable without the board, and both are read by the same
validator, so a `node` that is present but empty is not an address and its token is refused like any other
malformed one. The chip leads with whichever address names the thing: the node for prose, the path for
source.

The composer parses valid tokens when a seeded prompt opens, renders each as a removable attachment chip,
and leaves the surrounding text as the human's editable intent. Submission serialises the chip(s) back into
the same prompt text and uses the existing `createSession` entry point. Malformed tokens remain visible text;
They are never silently discarded. No API route, session field, or alternate dispatch path belongs here —
a token sent to an ALREADY-RUNNING session ([[prose-dispatch]]) rides the ordinary session input route for
the same reason, as one more prompt rather than a channel of its own.
