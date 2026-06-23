---
title: injected-context
status: active
hue: 280
desc: What the harness feeds a launched session so it starts (and stays) spec-aware — a live spec path, never an inlined body, plus a one-shot nudge at the read→write boundary.
---

# injected-context

## raw source

A dispatched session should begin already knowing **which spec is its ground truth**, and should be caught
the moment it forgets — but the launcher must never **inline a spec body**: a pasted snapshot bloats the
launch prompt toward truncation and freezes a copy that goes stale the instant the agent edits the file.
The harness injects only **pointers and reminders**, so the agent always reads the live contract itself.

## expanded spec

Two thin injections, both deliberately *non-enforcing* (the Stop gate is the enforcer):

- **[[spec-pointer]]** — when a dispatch names an existing node, append **one line**: the absolute path to
  that node's live `spec.md` inside the new worktree. Never the body. Fail-quiet by absence — an unknown id
  or a `@new` placeholder appends nothing.
- **[[spec-first]]** — a one-shot `PreToolUse` nudge that fires once, exactly at the first code-mutating
  edit, telling the agent to read its node's spec and reconcile against it (change the spec if intent
  changed, else make code honor it). Editing a spec first blesses silently; a code edit first blocks once,
  then passes.

Together they make spec-awareness the session's starting condition without ever duplicating spec text into
a prompt: point at the live file, remind at the moment it matters, enforce elsewhere.
