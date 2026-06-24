---
title: governed-related
status: active
hue: 200
desc: Split a node's files into GOVERNED (owned — drives drift/yatsu, as before) and RELATED (referenced — coverage only, never drift/yatsu); a file with >=2 governors is a hub that both signals skip.
related:
  - spec-cli/src/specs.ts
  - spec-cli/src/lint.ts
  - spec-yatsu/src/cli.ts
---

# governed-related

## raw source

A node's `code:` list means two incompatible things at once. For **coverage** it is a governance link,
naturally many-to-many — every hub file claimed from each feature that reaches it. For **attribution** —
drift, yatsu, "is this mine?" — it must be ownership, one owner per file. Reading governance AS ownership is
why a change to one hub file (`cli.ts`, `sessions.ts`, `styles.css`) fans a stale/uncovered signal across
every co-owner. Separate the two relations — and give them two SIGNAL SHAPES.

## expanded spec

Two relations on a node:

- **governed** (`code:`) — the files the node is source of truth for. Drives coverage AND historical
  drift/yatsu, unchanged.
- **related** (`related:`) — files the node references but does not own. Counts for **coverage** only;
  never drift, never yatsu. The escape valve that lets a co-owner reference a hub without owning its loss
  signal. (This node dogfoods it: it owns no file, and lists its implementation as `related:`.)

Built and live: a file governed by **>=2 nodes is a hub** with no single owner, so [[spec-lint]]'s `drift`
and [[yatsu-core]]'s `scan` now EXCLUDE hub files — attributing to nobody beats fanning across all
co-owners. The `hub` lint rule reports them in one summary line with the remedy. [[spec-of-file]] surfaces
the same at the edit (flags a hub, stays silent on a cleanly-owned file). The remedy for a hub: move it out
of the co-owners' `code:` into `related:`, leaving ONE owner — drift/yatsu then resume on that owner.

The migration is DONE: all 21 hubs now have a single owner (the `hub` warning reads 0), via two new
foundation nodes ([[sessions-core]], [[dashboard-shell]]), the [[spec-cli]] package node owning the
server/CLI entries, and a clear owner for the rest. Still ahead: the present-tense "this commit touched
files related to specs X, Y — glance at them" nudge for related files (a pointer, not a verdict); deriving
relatedness from the import graph so a node declares only what it owns; and the residual smell the migration
exposed — `sessions.ts` is a monolith whose slice-features ([[dispatch]], [[graph]], [[session-selectors]],
[[agent-reply-channel]], [[spec-pointer]]) now hold no code of their own until a code split gives each one back.
