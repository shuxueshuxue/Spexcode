---
title: paged-palette
status: active
hue: 205
desc: The dashboard search palette keeps node/session ranking local but obtains bounded Issue/Eval planes from paged-review instead of graph row arrays.
code:
  - spec-dashboard/src/SpecSearch.jsx
related:
  - spec-dashboard/src/reviewPage.js
  - spec-dashboard/src/corpus.js
  - spec-dashboard/src/address.js
---

# paged-palette

The one graph/session search palette still ranks node prose from the lite corpus and live session identity
locally. Its Issue and scenario planes are demand data: while the palette is open, the debounced text drives
page 1 of `/api/issues` and current `/api/evals`; each contributes at most 25 matching rows and the palette
interleaves them with node/session hits exactly as before. `/api/specs/lite` contains node prose only, never
scenario declarations that recreate the Eval list. Opening the palette therefore pays bounded review rows,
while never opening it pays none.

An Issue hit routes to its detail. A measured Eval hit routes to its detail; a blind scenario routes to the
canonical node-filtered Evals list because it has no result detail. Plane boost, keyboard ownership, and
selection routing remain [[session-search]]'s single shared behavior.
