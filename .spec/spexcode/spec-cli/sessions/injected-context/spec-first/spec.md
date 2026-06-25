---
title: spec-first
status: active
hue: 280
desc: A one-shot PreToolUse nudge — read your node's spec (and its neighbors) before you read or edit code, reconcile against it, never silently diverge.
code:
  - spec-cli/hooks/spec-first.sh
---

# spec-first

## raw source

The standing contract already tells an agent to read its spec before implementing ([[core]]), but a
standing instruction is easy to scroll past. Catch it at the moment it matters: the agent's FIRST reach for
the code. That moment is **reading**, not just writing — a pure analysis or "explain this" session reasons
straight from the source and never opens the contract at all, which a mutate-only trigger lets sail past.
So fire at the first code ACCESS, read or edit. Firing exactly once lands when it counts; firing on every
access would just be noise the agent learns to ignore.

## expanded spec

A PreToolUse hook (`spec-first.sh`), wired alongside `mark-active` via `settingsJson`. It acts on the
code-ACCESS tools (`Read` / `Edit` / `Write` / `NotebookEdit`); everything else passes untouched.

**Bless, ignore, or nudge — once per session.** A sentinel (`.session/spec-checked`, under the ignored
runtime dir — [[runtime]]) makes it fire at most once:

- First access touches a **spec file** (`.spec/…` or a `spec.md`) → the agent is *already* grounding → set
  the sentinel and allow, **silently**. Reading the spec can never be the thing it blocks.
- First access touches the session's own **runtime state** (`.session/…`) → allow **without** consuming the
  one-shot — neither code nor grounding.
- First access touches a **code file** → set the sentinel and **block once** with the reminder; the agent
  reads its spec, re-issues the access, and it passes. Every later access passes too.

The reminder carries the reconcile-against framing of [[core]], not "obey the spec": *read your node's spec
— resolved from the `.session/state` node id, or `spex search <topic>` when the session has none — AND its neighbors
(parent, siblings, children), since a node's intent is only fully legible against the surrounding tree; then
change the spec if the task changes intent, or make code honor it if it implements existing intent; the one
forbidden move is code that silently diverges.*

Its own sentinel (never `.session/state`) keeps it from racing `mark-active`'s state write on the same
event. Fail-open: an access made through `bash cat/sed` slips past — this *reminds*, it does not enforce
(the Stop gate is the enforcer). Its edit-time twin [[spec-of-file]] names the governing spec at each edit.
