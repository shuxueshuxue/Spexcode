---
title: spec-first
status: active
hue: 280
desc: A one-shot PreToolUse nudge — read your node's spec before you write code, reconcile against it, never silently diverge.
code:
  - spec-cli/hooks/spec-first.sh
---

# spec-first

## raw source

The standing contract already tells an agent to read its spec before implementing ([[core]]), but a
standing instruction is easy to scroll past. The moment that actually matters is the transition from
reading to **writing code** — so catch it there. A reminder that fires exactly once, right as the agent
first reaches for a code-mutating tool, lands when it counts; firing on every edit would just be noise the
agent learns to ignore.

## expanded spec

A PreToolUse hook (`spec-first.sh`), wired alongside `mark-active` on PreToolUse via `settingsJson`. It
acts only on the code-mutating tools (`Edit` / `Write` / `NotebookEdit`); everything else passes untouched.

**Bless or nudge, by what's being edited — once per session.** A sentinel file (`.session/spec-checked`,
under the ignored runtime dir — [[runtime]]) makes it fire at most once:

- First mutation targets a **spec file** (`.spec/…` or a `spec.md`) → the agent is *already* spec-first →
  set the sentinel and allow, **silently**. Doing it right never earns a nag.
- First mutation targets a **code file** → set the sentinel and **block once** with the reminder; the
  agent re-issues the same edit and it passes (the sentinel is now set). Every later edit passes too.

The reminder carries the reconcile-against framing of [[core]], not "obey the spec": *read your node's
spec (resolved from the `.session/state` node id to its `.spec/…/<id>/spec.md`, or `spex board` when the
session has no node) — then change the spec if the task changes intent, or make code honor it if it
implements existing intent; the one forbidden move is code that silently diverges.*

Its own sentinel file (never `.session/state`) is deliberate: two PreToolUse hooks fire on the same event,
so spec-first touching a **different** file than `mark-active`'s state write means they never race. The hook
is only ever wired into post-[[runtime]] sessions, so it assumes the `.session/` layout and needs no legacy
fallback. Fail-open: an edit made through `bash sed/echo` slips past — this *reminds*, it does not enforce
(the Stop gate is the enforcer).
