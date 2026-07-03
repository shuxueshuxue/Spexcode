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
---
# id-url-safe

## raw source

A node id is a single opaque token, not a path. It is the coordinate every surface uses to name one
node — a `:id` route param, a fetch URL segment, a `[[wikilink]]`, a React key, a corpus match, a
`node/<id>` branch. So it must survive all of them unescaped: it can never contain a `/` — which would
split into two path segments — nor any other char a URL, wikilink, or DOM key treats specially. One id,
one token, resolvable the same way everywhere.

## expanded spec

The invariant is guaranteed at the MINT, not patched at each use. [[source-of-truth]]'s loader (`reId`
in `specs.ts`) keys each node to its leaf dir name, or — when that leaf collides — the shortest
parent-qualified suffix that disambiguates. That suffix joins its path segments with `_`, never `/`:
like `/` the underscore never occurs inside a dir basename, so the join stays unambiguous, but unlike
`/` it is a URL-unreserved, wikilink-, and DOM-safe char. So a disambiguated id like `.config_spec-scout`
is still one token — the same shape a non-colliding id already wears.

Because the mint guarantees it, every RESOLVE site is uniform and needs no special-casing:

- **backend routes** — Hono's `/api/specs/:id/...` binds the id as one path segment; with no `/` in the
  id, that segment is the whole id.
- **frontend fetches** — one helper (`specUrl` in `data.js`) is the sole builder of a `/api/specs/:id/*`
  URL: it `encodeURIComponent`s the id and appends the fixed route words. No call site hand-rolls the
  string, so none can reintroduce a broken URL for an awkward id.
- **[[mentions]]** — a `[[id]]` token whose chars already lie within the wikilink charset.
- **corpus / search / DOM keys** — the id is used verbatim as a plain string; a single token is safe.

Before this, `reId` joined colliding suffixes with `/`, minting ids like `.config/spec-scout`. The tree
row rendered, but opening the node 404'd every `:id` fetch (the `/` split the route), so the graph
could point at a node no detail view could load. Correcting the separator at the mint repairs every
resolve site at once — the root, not the symptoms.
