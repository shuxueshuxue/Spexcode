---
title: selection-attachment
status: active
hue: 205
desc: One removable, readable selection attachment shared by prose dispatch, the New Session composer and the Conversation's quote.
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

Selections have one visual and interaction contract wherever the ordinary prompt carries them. The
prose-selection send card (in its composer's preview slot), the New Session seed queue and the Conversation
composer's quote queue all render `SelectionAttachment`: one mark, the address that names the source, the
extent within it, and one icon-only remove action wearing the board's shared quiet
icon-button face — never a browser-default button box. The row is a removable attachment, not a second editor or a new dispatch route.

**Two of those three parts follow the flavour, and the component owns both answers so no producer picks its
own.** The address is the node for prose, the path for code, the session for a passage quoted out of a
conversation. The extent is the inclusive line range for anything that lives in a file and the MOMENT it was
said for a quote, because a conversation is addressed by when rather than by where. The mark follows the same
split: the file-diff mark for a passage that lives in a file, the reply mark for one quoted out of a
conversation. Where the token can only carry an id but the producer knows a human name for it — a session's
headline — the producer supplies that name and the id stays in the row's title, so the chip reads as an
address rather than as a uuid.

The producers own only their delivery context. Prose dispatch removes the selection and closes its card;
the New Session composer removes one decoded token from its local queue. Both still serialise through
`codeSelection.js` and the existing ordinary prompt/createSession path. Styling stays shared with the
quiet bordered co-work rows used by the review surfaces, so no `pa-chip` or `si-code-selection-chip`
dialect may return.
