---
title: id-url-safe
status: active
session: 35b68fb6-7f4f-43a1-97a5-0823fae8a834
hue: 210
desc: A node id is a URL-safe single token — guaranteed at the mint, resolved one way everywhere.
code:
  - spec-cli/src/specs.ts
related:
  - spec-dashboard/src/data.js
  - spec-eval/src/scenarios.ts
---
# id-url-safe

## raw source

A node id is a single opaque token, not a path. It is the coordinate every surface uses to name one
node — a `:id` route param, a fetch URL segment, a `[[wikilink]]`, a React key, a corpus match, a
`node/<id>` branch. So it must survive all of them unescaped: it can never contain a `/` — which would
split into two path segments — nor any other char a URL, wikilink, or DOM key treats specially. One id,
one token, resolvable the same way everywhere.

## expanded spec

The invariant is guaranteed at the MINT, not patched at each use. [[source-of-truth]]'s loader keys each
node through the exported mint (`mintIds` in `specs.ts`): its leaf dir name, or — when that leaf
collides — the shortest parent-qualified suffix that disambiguates. That suffix joins its path segments
with `_`, never `/`: like `/` the underscore never occurs inside a dir basename, so the join stays
unambiguous, but unlike `/` it is a URL-unreserved, wikilink-, and DOM-safe char. So a disambiguated id
like `.plugins_spec-scout` is still one token — the same shape a non-colliding id already wears. The mint
also pins the id to NFC: the RESOLVE machinery is script-agnostic (a CJK dir name still resolves
everywhere — macOS hands out NFD basenames, so without one canonical form a typed `[[中文节点]]` (NFC,
what an IME emits) would fail the string-match against the very node it names). The authored norm and
the machinery speak the SAME vocabulary — the exact per-character whitelist defined once in
[[spec-lint]]'s id-format rule (referenced here, not restated) — so a CJK dir name is a first-class
authored id, not merely a survivable foreign one; what id-format forbids (space, `/`, `_`, uppercase
Latin, control chars) the mint never has to repair.

The mint is ONE, and every id producer shares it. `spec-eval`'s node walk mints its ids through the same
exported function, over the same universe (every spec node — a leaf that collides among spec nodes is
disambiguated even when only one of them carries a eval.md), so `spex eval add/show` answer to exactly
the id the board and scan print. Before this, the eval engine keyed nodes to the bare leaf name — a second id scheme
that diverged on every collision: the canonical id read as "no measurable node" while the bare leaf silently hit
whichever colliding node the walk met first, so no colliding node could reliably take a reading.

Because the mint guarantees it, every RESOLVE site is uniform and needs no special-casing:

- **backend routes** — Hono's `/api/specs/:id/...` binds the id as one path segment; with no `/` in the
  id, that segment is the whole id.
- **frontend fetches** — one helper (`specUrl` in `data.js`) is the sole builder of a `/api/specs/:id/*`
  URL: it `encodeURIComponent`s the id and appends the fixed route words. No call site hand-rolls the
  string, so none can reintroduce a broken URL for an awkward id.
- **[[mentions]]** — a `[[id]]` token whose chars lie within the wikilink charset (any unicode
  letter/number plus `-_.` — script-agnostic, so a CJK id mentions like an ASCII one).
- **corpus / search / DOM keys** — the id is used verbatim as a plain string; a single token is safe.

Before this, `reId` joined colliding suffixes with `/`, minting ids like `.plugins/spec-scout`. The tree
row rendered, but opening the node 404'd every `:id` fetch (the `/` split the route), so the graph
could point at a node no detail view could load. Correcting the separator at the mint repairs every
resolve site at once — the root, not the symptoms.
