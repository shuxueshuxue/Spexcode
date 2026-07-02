---
title: spec-pointer
status: active
hue: 280
desc: When a dispatched session names an existing node, point the agent at that node's live spec.md by path — never inject the body.
related:
  - spec-cli/src/sessions.ts
---

# spec-pointer

## raw source

A session dispatched against an existing spec node should start already knowing **which spec is its ground
truth** — without the launcher pasting the spec body into the prompt. Inlining a snapshot bloats the launch
prompt toward the truncation limit and freezes a copy that goes stale the moment the agent edits the file.
A **path is enough**: hand the agent one line pointing at the spec, and it reads the live file itself.

## expanded spec

When [[launch]]'s `newSession` resolves a node ref — explicit `--node`, else the prompt's first `@mention` —
to a node that **already exists** in the committed spec tree, it appends **one line** to the launch prompt:
an **absolute path** to that node's `spec.md` **inside the new session's own worktree**. The ref is resolved
against the loaded spec index to that node's worktree-relative spec path (the index entry's own `path`, which
already carries the `.spec/` prefix); since the worktree is freshly branched off main, that relative path is
identical there, so the absolute pointer is just the worktree dir joined with it.

The `@mention` grammar must name **every** node, so it admits an **optional leading dot**: a node id is its
directory basename, so a dot-prefixed config root keeps the dot (`.config`), and without the leading dot
`@.config` would capture nothing and silently lose both the pointer and the session's node attribution.

Only the **pointer** is appended — never the spec **body**. The agent opens the live file, so it always sees
the current contract, and the launch prompt stays small (well under the shell-arg truncation limit [[launch]]
guards against). It only **augments** a dispatch that names an existing node — the sole prompt rewrite
`newSession` does, now that node create/delete is prompt-driven agent work and the server builds no directive
prompts (see [[dispatch]]).

It is **fail-quiet by absence**: a prompt with no `[[id]]` and an unknown id both resolve to nothing, so no
pointer is appended and the agent launches with the human's prompt unchanged.
