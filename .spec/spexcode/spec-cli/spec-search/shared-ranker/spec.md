---
title: shared-ranker
status: active
hue: 200
desc: One lexical scoring core, two callers — the server floor and the dashboard palette rank by the same maths (not a second hand-rolled scorer), so the palette stops ranking node prose more crudely than the agent's spex search.
code:
  - spec-cli/src/ranker.ts
related:
  - spec-cli/src/search.ts
  - spec-dashboard/src/SpecSearch.jsx
---
# shared-ranker

## raw source

There were two rank implementations: the `/` palette scored client-side (its own tiered substring match in
`SpecSearch.jsx`), the floor scored server-side (`search.ts`). Two implementations of "which spec is most
relevant" is a smell — they can drift, and a human's palette already ranked node prose **more crudely** than
the agent's `spex search`. The fix is **not** to make one call the other (the palette must stay instant over
already-loaded board data; the floor must stay filesystem-only and node-only). The fix is to share the one
thing that should never differ — **the scoring** — and let each caller keep what genuinely differs: its data
and its query intent.

## expanded spec

`ranker.ts` is the **pure, I/O-free scoring core** ([[spec-search]]'s scorer, lifted out): `terms` · a light
query-side `stem` (plural-`s`/mute-`e` drop) · `nameMatch`/`textMatch` · `tierWeight` (name > desc > body;
desc is presence × BM25 length-norm, body full BM25 term-frequency) · corpus IDF ·
`snippetFor`, all behind one entrypoint `rankDocs(query, docs)` over a generic `{ ref, name, desc, body }`
shape. No fs, no git, no DOM — so **tsx runs it server-side and vite bundles it for the browser** (verified:
a cross-package import from the dashboard builds clean).

- **floor caller** — `search.ts`'s `searchSpecs` maps each spec node (`loadSpecsLite`) to one doc and ranks.
- **palette caller** — `SpecSearch.jsx` ranks **each plane separately** with `rankDocs`, then **interleaves**
  the four ranked lists by plane (a node, a session, an issue, a scenario, repeat). One unified call over all
  four was the obvious first move and it is WRONG — nodes carry far richer text than sparse sessions/issues,
  so a single relevance list buries the non-node planes (a node-heavy query returned only nodes; caught
  in-browser). Per-plane ranking keeps the shared scorer's quality within a plane; the interleave keeps every
  matching plane visible — the palette's whole reason to exist. A bonus: ranking the node plane on its own
  corpus means the palette ranks NODES over the same corpus the floor does, so node order matches `spex search`.

**What is NOT shared** (the deliberate divergence): each caller chooses its own `query` (the floor tokenises a
question; the palette can pass a typed fragment), its own corpus, and its own assembly — the floor returns one
node list, the palette interleaves four planes. `rankDocs` sorts **stably** by score, so equal-scored docs keep
the caller's input order (the floor pre-sorts by shorter id then id; the palette by shorter name within each
plane). The core stays free of any caller's identity: it scores `{name,desc,body}` and nothing else.

**Invariant:** lifting the scorer is a behaviour-preserving refactor of the floor — `search.bench.mjs` reports
the same recall/MRR before and after. That bench is the guard; a drift means the extraction broke the maths.
