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
A one-shot grounding gate. The first time a session touches code — reads OR mutates any non-spec file — without having opened its spec, it blocks once to demand the right order of work: read the governing node's spec first, since it is the current contract, and read its neighbors too, because a node's intent is only fully legible against the tree around it. Then reconcile deliberately — change the spec if the intent is changing, or make the code honor it — never silently diverge.

It blocks at most once per session: a sentinel records the first touch, and every later access passes. Unlike the board-lifecycle hooks, spec-awareness is UNIVERSAL — this is NOT gated on `governed`, so it serves any agent, dashboard-launched or user-self-launched. The sentinel lives as a sibling file in the session's global store dir (keyed by the payload's `session_id`), created on demand even for a self-launched session that has no record; the node it points the agent at is read from the record when the session is bound to one, else a generic "find the governing node" nudge. Reading is included on purpose, not just editing — a pure analysis session that reasons straight from code without ever opening the contract is exactly the grounding gap this closes. Doing it right earns no nag: an agent whose first code touch IS its spec (reading or editing it) is blessed silently.

This enforces the read-the-contract-first rule of [[core]] at the moment of first contact, before understanding hardens around ungrounded code.
