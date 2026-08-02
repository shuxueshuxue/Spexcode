---
title: forge-link
surface: system
status: active
hue: 280
desc: A config plugin — agents link an issue or change request opened through the resolved forge to the spec node it serves via one `Spec: <id>` body line.
code:
---
Every forge issue or change request body includes `Spec: <node-id>` (comma-separate several). Use each node's
leaf directory name, not its slash path; `spex graph --json` lists valid ids.
