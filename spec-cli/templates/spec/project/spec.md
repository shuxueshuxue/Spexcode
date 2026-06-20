---
title: project
status: active
hue: 45
desc: The root spec node — the founding intent this repo's spec tree hangs from. Rewrite it to your own.
---
# project

The root of your spec tree. In SpexCode the spec tree IS ground truth and git is its database: every
node is a `spec.md` stating present intent, and each version change is attributed to the session that
made it. This node is the founding spec everything else hangs from — **rewrite this body to describe
your own project**, then grow child package/feature nodes beneath it (each its own directory with a
`spec.md`).

`.config/` holds the dev-flow plugins this instance ships — skill-shaped flat child nodes, each tagged
with a `surface` field: a `surface: system` node folds into every launched agent's system prompt as
always-on contract (the seed ships `core`), and a `surface: slash` node is a prompt preset the
new-session dropdown composes over target nodes (the seed ships `tidy` and `health`). Add, edit, or
remove plugins by editing those spec nodes.
