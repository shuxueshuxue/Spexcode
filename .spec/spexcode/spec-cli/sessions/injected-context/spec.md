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
- **[[inject-spec-first]]** — a one-shot `PreToolUse` read gate that advances only on code with a real
  governor, telling the agent to read that governing spec and its relevant neighbors before retrying.
  Irrelevant and ungoverned reads leave it armed, so uncovered exploration cannot mute a later governed
  boundary.
- **[[inject-spec-of-file]]** — a per-edit `PostToolUse` annotation that, once per file, names the spec governing
  the file just edited (and flags a shared-hub file with many owners). Non-blocking — the contract kept in
  view at the edit, not just at the start.

Together they make spec-awareness the session's starting AND running condition without ever duplicating
spec text into a prompt: point at the live file, ground before the first governed read, name actionable
ownership problems at each edit, enforce elsewhere.

All three are **passive** and assume the agent already knows *which* node is its ground truth. A fourth,
**active** injection is a retired experiment — an injected spec-consult sub-agent (the spec analog of
code search) for behaviour questions not bound to one node — so a session can *find* its governing spec, not
only be pointed at one it already knows. Pending; the three above are what ships today.
