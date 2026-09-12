---
title: plugins-view
status: active
hue: 40
desc: Reads every plugin surface a project declares and, per worktree, what is actually installed there — both halves from the loaders that materialize them.
code:
  - spec-cli/src/plugins-view.ts
related:
  - spec-cli/src/index.ts
  - spec-cli/src/hooks.ts
  - spec-dashboard/src/PluginsView.jsx
---

# plugins-view

A project's automation has two halves and they are not the same thing. One is what the `.plugins` tree
DECLARES — which node plugs into which surface, which lifecycle event a hook binds, in what order, and
whether it may refuse. The other is what is actually INSTALLED, and that half has as many answers as the
project has worktrees, because materialization writes one manifest into each registered tree's slot. This
surface answers both, for [[plugins-page]] to draw.

## both halves come from one reader

The declared half is read through [[plugin-system]]'s own loaders — `loadHookConfig`, `loadSystemConfig`,
`loadConfig`, `loadSkillConfig`, `loadAgentConfig` — and the installed half through the same
`compileManifest` the materializer writes. Nothing here re-parses frontmatter or re-derives a manifest. A
second reader would be a second opinion, and the whole point of the surface is to show where the one
opinion has not arrived yet; a picture drawn from its own parse could disagree with the truth and look
authoritative doing it.

## a node is reported once, carrying every surface it declares

`surface` is a membership list, not a value ([[surface]]): `distill` and `merge` are each a skill AND a
command. The rows are therefore keyed by node name and accumulate surfaces, because the alternative — one
row per surface — double-counts the node, and the alternative to THAT, a folder tree, can only show it
once and must pick a lie. An empty surface stays in the list: `agent` currently holds nothing, and a
vocabulary slot nobody uses is a fact worth reporting, not one to hide.

## the spine is a reading order, and an unknown event is louder than a missing one

Hook bindings name events, not a timeline; no source declares a total order over them. The lifecycle order
is therefore written in this module, as the sequence a person meets those events in over one session, and
it is a reading device rather than data. An event a node binds that is NOT in that order still appears —
appended and flagged — because the surface's job is to account for every binding, and one that silently
vanished from the page would be worse than one that looks out of place on it.

## it reports what is declared, and nothing about where it is installed

An earlier version of this surface also compared each worktree's materialized `hooks-manifest` against the
compiled one and reported how many trees agreed. Every framing of that number was wrong, and the last one
was wrong in a way worth writing down: a worktree's manifest is compiled from THAT WORKTREE'S OWN `.spec`,
so a session working on a base from three weeks ago has a manifest that faithfully matches the contract its
tree declares. Comparing it to the trunk's contract measures how far behind the branch is, not whether
anything is misconfigured — and the trees disagreed exactly as much after being re-materialized as before,
because there was nothing to repair. A tree carrying NO manifest would be a real fault, but that belongs
with session health, not with an inventory of what the plugins are.

## what it does not do

It reads. It does not materialize, repair, enable, or disable anything, and it takes no argument that
could select a subset — a surface that could also change the thing it reports would make the two halves
one again.
