---
title: forge-link
surface: system
status: active
hue: 280
desc: A config plugin — agents link an issue or change request opened through the resolved forge to the spec node it serves via one `Spec: <id>` body line.
code:
---
When you open an issue or change request through the repository's resolved forge, link it to the spec node(s) it serves by adding one line to its **body**: `Spec: <node-id>` (comma-separate several). The id is the node's **leaf** name — the folder under `.spec/…/<id>/spec.md`, e.g. `sessions`, never the slash-path. An unrecognized id silently links nothing, so use a real node id (`spex graph --json` lists them). This is the one linking marker on every forge.
