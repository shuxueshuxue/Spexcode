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

`ranker.ts` is the **pure, I/O-free scoring core** ([[spec-search]]'s scorer, lifted out): `terms` ·
`nameMatch`/`textMatch` · `tierWeight` (name > desc > body) · BM25 body term-frequency · corpus IDF ·
`snippetFor`, all behind one entrypoint `rankDocs(query, docs)` over a generic `{ ref, name, desc, body }`
shape. No fs, no git, no DOM — so **tsx runs it server-side and vite bundles it for the browser** (verified:
a cross-package import from the dashboard builds clean).

- **floor caller** — `search.ts`'s `searchSpecs` maps each spec node (`loadSpecsLite`) to one doc and ranks.
- **palette caller** — `SpecSearch.jsx` maps all FOUR planes (nodes/sessions/issues/scenarios) to docs and
  ranks them in ONE call: because it is one scorer it is one score scale, so the four planes sort into a
  single list with no cross-scale reconciliation — the score-merge problem dissolves rather than being
  solved.

**What is NOT shared** (the deliberate divergence): each caller chooses its own `query` (the floor tokenises
a question; the palette can pass a typed fragment) and its own corpus, and pre-sorts its inputs in its own
tiebreak — `rankDocs` sorts **stably** by score, so equal-scored docs keep the caller's order (the floor:
shorter id then id; the palette: plane order then shorter name). The core stays free of any caller's identity.

So what is shared is the **algorithm, not identical results**: the palette's IDF is over its four-plane
corpus, the floor's over the node-only corpus, so the same query can order nodes a little differently in the
two surfaces. That is correct, not a bug — the corpora genuinely differ. The win is narrower and real: neither
side hand-rolls its own scoring, so the maths cannot silently drift apart.

**Invariant:** lifting the scorer is a behaviour-preserving refactor of the floor — `search.bench.mjs` reports
the same recall/MRR before and after. That bench is the guard; a drift means the extraction broke the maths.
