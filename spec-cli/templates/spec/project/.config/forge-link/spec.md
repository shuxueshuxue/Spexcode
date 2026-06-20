---
title: forge-link
surface: system
status: active
hue: 280
desc: A config plugin — agents link an issue they open to the spec node it serves via a `Spec: <id>` body line.
code:
---
When you open a GitHub issue, link it to the spec node(s) it serves by adding a line to the issue **body**: `Spec: <node-id>` (comma-separate several). The id is the node's **leaf** name — the folder under `.spec/…/<id>/spec.md`, e.g. `sessions`, never the slash-path. An unrecognized id silently links nothing, so use a real node id (`spex board` lists them). A pull request needs no marker: opening it from your `node/<id>` branch links it for free.
