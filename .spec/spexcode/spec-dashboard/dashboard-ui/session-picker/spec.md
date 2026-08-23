---
title: session-picker
status: active
hue: 205
desc: One session identity row and keyboard picker used wherever the dashboard chooses or names a session.
code:
  - spec-dashboard/src/SessionPicker.jsx
related:
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/NodeContextMenu.jsx
  - spec-dashboard/src/ProseActions.jsx
  - spec-dashboard/src/mentions.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/sessionPicker.test.mjs
---
# session-picker

The dashboard has one session identity language. A picker row leads with the deterministic avatar generated
from the session id, then the shared visible session title, and carries the lifecycle glyph from the shared
`sessionDisplayState` vocabulary. It never invents a second status colour or a second name accessor. The
stable session handle remains a matching key and tooltip detail; it is never painted as a second visible name.

`SessionPicker` is the active choice surface for an existing session. Its optional filter narrows the rows
locally, ↑/↓ moves the active row, Enter chooses it, and Escape leaves the draft untouched for the caller to
close. A caller may add the one `new` row for a fresh session. The picker emits ids; navigation and delivery
remain owned by the caller.

Mention autocomplete and the graph context menu may use the row primitive without taking ownership of the
picker state. The dock keeps its tree and fold semantics, but its session face uses the same row identity.
No surface renders a native `<select>` for session choice.
