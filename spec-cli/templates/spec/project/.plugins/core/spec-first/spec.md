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
A one-shot, governed-aware READ gate. Its state advances only when the agent is about to read code that has a real governor (`code:` ownership). The first such read creates the session sentinel and blocks once, naming the resolved governing spec and directing the agent through the relevant parent, sibling, and child contracts before retrying. Once that contract-read path has been demanded, later code reads pass.

The state machine has no transition for an irrelevant tool, an unresolvable path, or an uncovered/related-only file. In particular, any number of ungoverned reads remain allowed without consuming or muting the gate; a later governed read must still block. This is file governance, distinct from a session record's `governed` field: spec-awareness still serves dashboard-launched and user-self-launched agents alike, with the sentinel created on demand in the session's global store directory.

Event delivery and semantic matching have separate responsibilities. The hook subscribes to the shared `PreToolUse` lifecycle event because Claude and Codex shims deliver that event broadly. The harness adapter's single `read` matcher decides whether the payload represents a file read and extracts its path; the hook then asks the spec graph whether that path has a governor. Harness payload differences stay inside the adapter, while the gate and its state transitions stay one mechanism.

This enforces the read-the-contract-first rule of [[core]] only where a contract actually exists, at the moment before understanding hardens around governed code.
