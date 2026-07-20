---
title: spec-first
surface: hook
status: active
hue: 200
events:
- PreToolUse
order: 20
block: true
---
A one-shot, governed-aware READ gate. Native harness shims deliver `PreToolUse` broadly; the shared harness adapter matcher reduces only read-shaped payloads to a file path, and the hook then asks the spec graph whether that path has a real `code:` governor. Tool and payload differences never enter the gate itself.

Irrelevant tools, unresolvable paths, uncovered files, and related-only files are allowed without changing state. Any number of ungoverned reads therefore leave the session armed. The first later governed read creates the sentinel and blocks once, naming the governing spec and requiring its relevant parent, sibling, and child contracts before retrying; after that contract-read path, later code reads proceed.

File governance is independent of dashboard session governance, so this serves self-launched and dashboard-launched agents through the same mechanism. It enforces [[core]] only where a contract actually exists.
