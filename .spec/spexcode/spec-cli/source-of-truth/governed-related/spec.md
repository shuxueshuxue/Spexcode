---
title: governed-related
status: active
hue: 200
desc: Two relations on a node — GOVERN (source of truth, ideally one file; drives drift/yatsu; many nodes MAY share a file) and RELATED (referenced, carries coverage). A file governed by more than maxOwners nodes warns "split it". No hub-exclusion.
related:
  - spec-cli/src/specs.ts
  - spec-cli/src/lint.ts
  - spec-yatsu/src/cli.ts
---

# governed-related

## raw source

A node's link to code carries two relations the old single `code:` list conflated. **govern** is what the
node is the SOURCE OF TRUTH for — sharp, ideally one file, so drift and yatsu have an unambiguous subject.
**related** is everything it merely references — many, and it is what carries coverage. A file owned by
several nodes is NOT a defect to stamp out; it is ordinary composition. The real defect is a file owned by
TOO MANY nodes — it has accreted more independently-specified functionality than one file should hold. Read
the count as a smell on the FILE, not on its ownership.

## expanded spec

Two relations, one shape for spec nodes and yatsu scenarios alike (a yatsu.md owns nothing — only its
scenarios govern and relate):

- **govern** (`code:`) — the file the node is source of truth for, ideally one. Drives drift and yatsu
  attribution. **Many nodes may govern the same file** — a change fans drift to each, which is correct:
  every owner has a stake. There is no hub-exclusion; no owner's signal is suppressed.
- **related** (`related:`) — files referenced but not owned. Carries **coverage**: every code file must be
  reached by some node's related (or govern). No drift, no yatsu, no ack — a pointer, not a verdict.

**too-many-owners** — the file-rotated twin of breadth ([[spec-lint]]): when a file is governed by more than
`maxOwners` nodes (default 3), one summary warning fires, at lint and the commit gate. It blames the file's
size, not its ownership, and offers three moves, split first:

- **split the file** so each governing node reclaims its own module — the honest fix the [[sessions-core]]
  monolith still awaits;
- **merge the nodes** when the separate specs are really one concern;
- **single foundation owner** + relate the rest, when the file is a genuine shared substrate.

This inverts the earlier "one owner per file" rule: ownership is many-to-one BY DESIGN now, bounded only at
the high end. The model holds on **both** axes — spec nodes and yatsu scenarios (a yatsu.md owns nothing;
only its scenarios `code`-govern ≤1 file and `related`-reference the rest, and a file governed by too many
scenarios is the `yatsu-owners` smell). Still ahead: the foundation nodes the old single-owner migration
created to absorb monoliths ([[sessions-core]], [[dashboard-shell]]) become split-the-file candidates, not
permanent owners — the tree migration that splits those files so each governor reclaims its own module.
