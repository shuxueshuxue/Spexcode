---
title: ritual
status: pending
hue: 30
surface: system
desc: The dogfood commit ritual delivered as a config node, not hardcoded into the launcher.
code:
---
# ritual

The dogfood commit ritual — every change lands as a spec node on a `node/*` branch; the spec body and
the code it justifies move together in one `spec:` commit carrying a `Session:` trailer; the branch
merges into `main` with `--no-ff`; the body stays a living current-state document (no `## vN`, no
current-state/verdict) — is delivered as a **config node on the `system` [[surface]]**, folded into
every launched agent's system prompt.

The ritual is therefore **data in the spec tree**: editable and versioned like any other node, read by
an agent as its standing obligations, rather than a constant baked into the launcher. Changing how
SpexCode lands a change is a spec edit to this node, not a code change to the dispatcher.
