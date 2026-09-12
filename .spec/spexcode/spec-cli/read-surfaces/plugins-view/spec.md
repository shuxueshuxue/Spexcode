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

## installed is a count, and the denominator is the sessions

A row cannot say "live" or "not live": the answer differs per tree, because materialization writes one
manifest into each registered worktree's slot and the trees drift apart independently — a tree materialized
before a contract changed keeps running the old set until something materializes it again.

But the denominator is NOT the registry. Counted over every registered worktree the number is a census of
dormant directories: measured here, 169 trees with 11 matching, where 162 held no agent and the stale
manifest inside cost nobody anything. It means something only for a worktree an agent is in RIGHT NOW,
where a binding the contract does not declare is a hook actually running and a missing manifest is a
session with no Stop gate. So the sessions on the board supply the trees — over the same seven, four ran
the declared contract and three did not — and a project with no live session reports nothing rather than a
number nobody should act on. Each differing line is reported with the number of trees carrying it, so a
drift is named rather than merely counted.

## what it does not do

It reads. It does not materialize, repair, enable, or disable anything, and it takes no argument that
could select a subset — a surface that could also change the thing it reports would make the two halves
one again.
