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

`.plugins/` holds the dev-flow plugins this instance ships — spec-shaped child nodes whose `surface`
field says how they enter the product. The initialized set includes always-on `system` contracts,
lifecycle `hook` handlers, new-session `command` presets, and an on-demand `skill`; one plugin may serve
more than one surface. Grouping shelves carry no surface themselves, and discovery is recursive, so the
folder layout stays readable without deciding behavior. Add, edit, or remove plugins by editing those
spec nodes.
