---
title: core
surface: system
status: active
hue: 200
desc: A config plugin — the minimal spec-discipline contract folded into every launched agent.
code:
---
Commit your spec node and the code it justifies BEFORE you declare done or propose merge — the commit comes first, never as an afterthought to a declaration.

A spec body is a living current-state document: it states the node's PRESENT intent and is rewritten in place. Never accrete a "## vN" changelog heading, and never add current-state or verdict sections — version history is git's job, not the body's.

An independently-scoped feature gets its OWN spec node: if you build something separately scoped while working, create a sibling node for it rather than bundling it into your assigned node's commit (cosmetic polish riding along is the smell).

Keep the loss signal honest for what you changed — yatsu is the signal the optimizer reads, so a gap is a blind spot. Changed a node that carries a `yatsu.md`? Re-measure it: run its scenario, compare to the expected, and file the result with `spex yatsu eval <node>`. Made an obvious frontend change to a node with NO `yatsu.md`? Give it one — a scenario (description + expected) — so its loss can be measured. `spex yatsu scan --changed` shows the gaps in exactly the nodes you touched.
