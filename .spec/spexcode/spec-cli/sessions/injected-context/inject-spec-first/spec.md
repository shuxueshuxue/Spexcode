---
title: inject-spec-first
status: active
hue: 280
desc: A one-shot PreToolUse nudge — read your node's spec (and its neighbors) before you read or edit code, reconcile against it, never silently diverge.
code:
  - .spec/spexcode/.plugins/core/spec-first/spec-first.sh
---

# inject-spec-first

## raw source

The standing contract already tells an agent to read its spec before implementing ([[core]]), but a
standing instruction is easy to scroll past. Catch it at the moment it matters: the agent's FIRST reach for
the code. That moment is **reading**, not just writing — a pure analysis or "explain this" session reasons
straight from the source and never opens the contract at all, which a mutate-only trigger lets sail past.
So fire at the first code ACCESS, read or edit. Firing exactly once lands when it counts; firing on every
access would just be noise the agent learns to ignore.

## expanded spec

A PreToolUse hook (`spec-first.sh`) consumes the harness adapter's code-access path list. One tool call may
name several files — notably a Codex multi-file patch — so the hook judges the complete set: all-spec paths
bless the session, while any code path triggers the one-shot nudge. Tools with no resolved path pass untouched.

Spec-awareness is UNIVERSAL, so — unlike the board-lifecycle hooks — this is NOT gated on `governed`: it
serves any agent, dashboard-launched or user-self-launched. It resolves the session's GLOBAL store dir from
the payload's `session_id` (same scheme as [[state]]) and keeps its sentinel there.

**Bless, ignore, or nudge — once per session.** A sentinel (`spec-checked`, a sibling file in the session's
global store dir — [[runtime]], created on demand even for a self-launched session with no record) makes it
fire at most once:

- First access touches **only spec files** (`.spec/…` or `spec.md`) → the agent is *already* grounding → set
  the sentinel and allow, **silently**. Reading the spec can never be the thing it blocks.
- First access carries **no resolvable path** → allow **without** consuming the one-shot — neither code nor grounding.
- First access includes **any code file** → set the sentinel and **block once** with the reminder; the agent
  reads its spec, re-issues the access, and it passes. Every later access passes too.

The reminder carries the reconcile-against framing of [[core]], not "obey the spec": *read your node's spec
— resolved from the session record's `node` when it is bound to one, or `spex spec search <topic>` when it has none —
AND its neighbors (parent, siblings, children), since a node's intent is only fully legible against the
surrounding tree; then change the spec if the task changes intent, or make code honor it if it implements
existing intent; the one forbidden move is code that silently diverges.*

Its own sentinel keeps it from racing `mark-active`'s state write on the same event. An access shape the
adapter cannot resolve passes — this reminds; the Stop gate enforces. Its edit-time twin
[[inject-spec-of-file]] names the governing spec at each edit.
