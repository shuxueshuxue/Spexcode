---
title: session-multi-select
status: merged
hue: 20
desc: Retired session-list selection contract; bulk operations remain a deferred capability for a future dock-owned explicit selection mode.
related:
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/SessionContextMenu.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/test/session-multi-select.e2e.mjs
---

# session-multi-select

## retired contract

This node is retired and is not a current dashboard behavior. The former context-menu select item, checkbox list,
bulk close confirm, and list-owned drag/reparent mode were withdrawn with the duplicate internal session list.
Current single-session close, archive, rename, and attach remain available through their document or dock-owned
actions; row movement, where supported, belongs to [[dock-modes]], not this node.

Bulk close is intentionally deferred, not silently deleted. If batch operations are needed later, they belong to a
future **explicit selection mode in the dock's session list**, with its own current spec and product proof. Until that
node exists, no menu item, `SessionSelectBar`, checkbox, or bulk-close endpoint is part of the dashboard contract.

The historical `code:` and E2E references in this node remain as migration evidence for the retired surface. They must
be re-homed or removed only in a later anchor-cleanup batch after the replacement decision is recorded.
