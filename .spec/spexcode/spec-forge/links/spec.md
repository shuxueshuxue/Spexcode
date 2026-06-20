---
title: links
status: active
hue: 280
desc: The host-agnostic resolver — inverts a host's raw issues/PRs into node → { issues, prs } via three link sources (PR branch, issue-body marker, transitive).
code:
  - spec-forge/src/links.ts
---
# links

The host-agnostic heart of [[spec-forge]]. Given whatever a driver read off a host (open issues + PRs) and
the set of real node ids, it **inverts** them into per-node link lists: `node → { issues, prs }`. Pure —
no network, no git, no writes — so it is the same on every host; only the [[port]]'s driver is vendor-aware.

It establishes a link three ways:

- **branch** — a PR heading off `node/<id>` links to that node. Because a node id itself contains dashes,
  the branch is resolved by **longest-match against the known ids** (strip `node/`, take the longest id
  that equals the rest or is its `<id>-…` prefix), never by guessing where the `-<sha>` suffix begins.
- **marker** — an issue body line `Spec: <id>[, <id>]` (case-insensitive). Ids are validated against the
  known set, so a typo'd marker links **nothing** rather than inventing a node.
- **pr (transitive)** — an unmarked issue a PR closes (`closesIssues`) inherits that PR's node.

A node's issue list is de-duplicated so an issue reached by both a marker and a PR appears once — **marker
wins** (the explicit intent outranks the inferred link). Only nodes that actually have links are returned.

The split this encodes: the forge declares which node its work serves, but a node's *status* is never
touched here — definition and execution stay on separate axes (see [[spec-forge]]).
