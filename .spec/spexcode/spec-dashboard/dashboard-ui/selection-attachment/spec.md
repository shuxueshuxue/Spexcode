---
title: selection-attachment
status: active
hue: 205
desc: One removable, readable source-selection attachment shared by prose dispatch and the New Session composer.
code:
  - spec-dashboard/src/SelectionAttachment.jsx#SelectionAttachment
related:
  - spec-dashboard/src/codeSelection.js
  - spec-dashboard/src/ProseActions.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/selectionAttachment.test.mjs
  - spec-dashboard/test/source-selection.e2e.mjs
---
# selection-attachment

Source selections have one visual and interaction contract wherever the ordinary prompt carries them. The
prose-selection send card (in its composer's preview slot) and the New Session seed queue both render
`SelectionAttachment`: one file-diff mark, the address that names the source (node for prose, path for
code), the inclusive line range, and one icon-only remove action wearing the board's shared quiet
icon-button face — never a browser-default button box. The row is a removable attachment, not a second editor or a new dispatch route.

The producers own only their delivery context. Prose dispatch removes the selection and closes its card;
the New Session composer removes one decoded token from its local queue. Both still serialise through
`codeSelection.js` and the existing ordinary prompt/createSession path. Styling stays shared with the
quiet bordered co-work rows used by the review surfaces, so no `pa-chip` or `si-code-selection-chip`
dialect may return.
