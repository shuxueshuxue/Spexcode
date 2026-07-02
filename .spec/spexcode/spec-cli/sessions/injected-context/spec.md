---
title: injected-context
status: active
hue: 280
desc: What the harness feeds a launched session so it starts (and stays) spec-aware — a live spec path, a one-shot nudge at the first code access, and a per-edit reminder of which spec governs the file.
---

# injected-context

## raw source

A dispatched session should begin already knowing **which spec is its ground truth**, and should be caught
the moment it forgets — but the launcher must never **inline a spec body**: a pasted snapshot bloats the
launch prompt toward truncation and freezes a copy that goes stale the instant the agent edits the file.
The harness injects only **pointers and reminders**, so the agent always reads the live contract itself.

## expanded spec

Three thin injections, all deliberately *non-enforcing* (the Stop gate is the enforcer):

- **[[spec-pointer]]** — when a dispatch names an existing node, append **one line**: the absolute path to
  that node's live `spec.md` inside the new worktree. Never the body. Fail-quiet by absence — an unknown id
  or a node-agnostic prompt (no `[[id]]`) appends nothing.
- **[[spec-first]]** — a one-shot `PreToolUse` nudge that fires once, at the first code ACCESS (read or
  edit), telling the agent to read its node's spec and its neighbors and reconcile against it. Touching a
  spec first blesses silently; a code access first blocks once, then passes. Reading — not just writing —
  trips it, so an analysis session can't reason straight from code without ever opening the contract.
- **[[spec-of-file]]** — a per-edit `PostToolUse` annotation that, once per file, names the spec governing
  the file just edited (and flags a shared-hub file with many owners). Non-blocking — the contract kept in
  view at the edit, not just at the start.

Together they make spec-awareness the session's starting AND running condition without ever duplicating
spec text into a prompt: point at the live file, ground before the first read, name the owner at each edit,
enforce elsewhere.

All three are **passive** and assume the agent already knows *which* node is its ground truth. A fourth,
**active** injection is in design — [[spec-scout]], an injected spec-consult sub-agent (the spec analog of
code search) for behaviour questions not bound to one node — so a session can *find* its governing spec, not
only be pointed at one it already knows. Pending; the three above are what ships today.
