---
title: core
surface: system
status: active
hue: 200
desc: A config plugin — the minimal spec-discipline contract folded into every launched agent.
code:
---
# core

The ground spec-discipline contract every SpexCode agent honors. This is a **system** node ([[surface]] =
its `system/` location): its body is folded into every launched/resumed agent's `--append-system-prompt`
as an always-on contract — no slash, no agent choice. There is no longer any baked-in core string in the
launcher; this node IS the core, carried as data in the spec tree, so editing the contract is a spec edit
and takes effect on the next launch.

The contract it carries:

Commit your spec node and the code it justifies BEFORE you declare done or propose merge — the commit comes first, never as an afterthought to a declaration.

A spec body is a living current-state document: it states the node's PRESENT intent and is rewritten in place. Never accrete a "## vN" changelog heading, and never add current-state or verdict sections — version history is git's job, not the body's.

An independently-scoped feature gets its OWN spec node: if you build something separately scoped while working, create a sibling node for it rather than bundling it into your assigned node's commit (cosmetic polish riding along is the smell).
