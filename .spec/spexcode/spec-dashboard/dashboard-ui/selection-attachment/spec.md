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

**The row leads with WHAT NAMES THE PASSAGE TO A READER, and the component owns that answer so no producer
picks its own.** For a source file that name is the path; for a spec body the node. For a passage quoted out
of a conversation it is **the passage's own opening words** — not the session. A session id names nothing to a
human, and its headline names only the room the words were said in, which the reader of that composer is
already standing in; the words are the only part of a quote that says WHICH quote this is, and a row that
spent its width on the room instead was chrome about the obvious. The session stays in the row's title and in
the token, so the address is carried and recoverable without being painted. A quote's leading line only: the
newlines in a quoted passage are the transcript's, and this row is one line high.

The extent follows the flavour too — the inclusive line range for anything that lives in a file, the MOMENT it
was said for a quote, because a conversation is addressed by when rather than by where — and so does the mark:
the file-diff mark for a passage that lives in a file, the reply mark for one quoted out of a conversation.

The producers own only their delivery context. Prose dispatch removes the selection and closes its card;
the New Session composer removes one decoded token from its local queue. Both still serialise through
`codeSelection.js` and the existing ordinary prompt/createSession path. Styling stays shared with the
quiet bordered co-work rows used by the review surfaces, so no `pa-chip` or `si-code-selection-chip`
dialect may return.
