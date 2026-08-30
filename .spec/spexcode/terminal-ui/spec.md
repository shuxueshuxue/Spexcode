---
title: terminal-ui
status: merged
hue: 280
desc: Historical package boundary retired after its terminal implementation moved into spec-dashboard.
---
# terminal-ui

This node records the former `@spexcode/terminal-ui` package boundary. The package was never an independent
runtime owner: its only consumer was the dashboard, while the patched xterm lived in shared dependencies. The
implementation now resides with its owner under the dashboard terminal cluster: [[terminal-input]] governs the
component, [[terminal-io]] scopes the surface, and [[xterm-sync-resize]] / [[xterm-cell-grid]] govern the shared
patch script. The package directory and release entry are removed; this merged node remains only as an explicit
historical tombstone so the old published-package claim cannot be mistaken for current ownership.
