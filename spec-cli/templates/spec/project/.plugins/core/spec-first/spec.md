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

It blocks at most once per session: a sentinel records the first touch, and every later access passes. Reading is included on purpose, not just editing — a pure analysis session that reasons straight from code without ever opening the contract is exactly the grounding gap this closes. Doing it right earns no nag: an agent whose first code touch IS its spec (reading or editing it) is blessed silently, and the session's own runtime state is ignored without consuming the one-shot.

This enforces the read-the-contract-first rule of [[core]] at the moment of first contact, before understanding hardens around ungrounded code.
