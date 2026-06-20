---
title: ritual
status: active
hue: 30
surface: system
desc: The dogfood commit ritual delivered as a config node, not hardcoded into the launcher.
code:
---
# ritual

Every change lands as a commit on your `node/*` branch **before** you declare done or propose merge.
The spec node and the code it justifies move together in one `spec:` commit carrying a `Session:`
trailer; the branch then merges into `main` with `--no-ff`. Commit first — the Stop gate's commit check
is only a backstop.

A spec body is a **living current-state document**: it states the node's present intent and is rewritten
in place, never accreting a `## vN` changelog or current-state/verdict sections (version history is
git's job). See `CLAUDE.spexhidden.md` for the full dogfood ritual.

This contract is data in the spec tree, delivered on the system [[surface]] — folded into every launched
agent's `--append-system-prompt`. Changing how SpexCode lands a change is an edit to this node, not a
code change to the launcher.
