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
  - spec-dashboard/src/Dashboard.jsx
---
# code-selection

The source viewer's parent may carry a non-empty selection into the ordinary New Session composer. The
selection is context, not an instruction and not an automatic launch. Its token is one HTML comment whose
JSON payload contains `path`, `startLine`, `endLine`, and the exact selected `text`; JSON escaping keeps
arbitrary source lossless while the visible metadata remains readable in a prompt transcript.

The composer parses valid tokens when a seeded prompt opens, renders each as a removable attachment chip,
and leaves the surrounding text as the human's editable intent. Submission serialises the chip(s) back into
the same prompt text and uses the existing `createSession` entry point. Malformed tokens remain visible text;
They are never silently discarded. No API route, session field, or alternate dispatch path belongs here.
