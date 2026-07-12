---
scenarios:
  - name: shared-scoring-tiers
    tags: [cli]
    code: spec-cli/src/ranker.ts
    related: [spec-cli/src/search.bench.mjs]
    description: >-
      The one thing both callers must never differ on is the SCORING. Drive the shared core `rankDocs`
      directly over a generic `{ ref, name, desc, body }` doc set (the exact shape the floor's `searchSpecs`
      and the palette's `SpecSearch.jsx` both pass): a query whose term hits one doc's NAME, another's DESC,
      and a third's BODY (with filler docs that lack the term so IDF stays positive — a term in EVERY doc
      correctly scores 0). Confirm the name>desc>body tier order, and that `rankDocs` sorts STABLY — two
      docs with identical fields keep the caller's input order. This is measured through the real exported
      `rankDocs`, the same entrypoint tsx runs server-side and vite bundles for the browser.
    expected: >-
      The NAME-hit doc ranks #1 (its tier weight dominates), with the DESC-hit and BODY-hit docs both
      present below it (desc's length-normalised presence tier at/above a single body mention); a doc that
      genuinely concentrates a rare term in its body still climbs via BM25. Equal-scored docs preserve
      input order (a stable sort), so each caller's own pre-sort (the floor by shorter-id, the palette by
      shorter-name within a plane) is respected. Zero loss = one scorer, identical maths for both callers;
      the floor's `search.bench.mjs` recall/MRR is the corpus-scale guard that the extraction stayed
      behaviour-preserving.
  - name: cjk-unigram-tokenizer
    tags: [cli]
    code: spec-cli/src/ranker.ts
    related: [spec-cli/src/search.ts, spec-dashboard/src/SpecSearch.jsx]
    description: >-
      Both callers were blind to CJK because a whitespace/`[^a-z0-9]` split discards every CJK character.
      The shared `tokenize` fixes it ONCE: an ASCII alphanumeric run is one token AND each CJK character
      (Han + kana) is its own token (a unigram), the SAME split on query and doc. Drive the real exported
      `terms` and `rankDocs`: check `terms` keeps CJK characters (including a length-1 CJK token, which
      survives the length-1 ASCII drop) while dropping a length-1 ASCII token, and check `rankDocs` over a
      doc set where one doc's body carries CJK prose and another is English-only — a CJK query, single-char
      included, must reach the CJK-body doc and rank it, with no per-language branch.
    expected: >-
      `terms("会话 abc x")` yields the CJK unigrams 会 and 话 plus `abc`, and drops the length-1 ASCII `x`.
      `rankDocs("节点", docs)` ranks the CJK-body doc first (high CJK IDF — few docs carry any CJK) and
      never returns the English-only doc; a single-char query (`"点"`) still matches it. One tokenizer, no
      language sniffing, so the floor reaches the CJK prose a few nodes carry and the palette gains CJK over
      its frequently-Chinese session/issue planes for free.
---
# eval.md — shared-ranker

YATU through the REAL exported scoring core (`terms` / `rankDocs` in `spec-cli/src/ranker.ts`) — the one
entrypoint both concrete callers invoke (the server floor via `searchSpecs`, the dashboard palette via
`SpecSearch.jsx`), the same module tsx runs server-side and vite bundles for the browser. The loss watched
here is the shared scorer's contract: the name>desc>body tiering with IDF/BM25, the stable sort both
callers rely on, and the one CJK-aware tokenizer that gives both surfaces Chinese with no per-language
branch. The floor's `search.bench.mjs` recall/MRR is the standing corpus-scale guard that lifting the
scorer out of `search.ts` stayed behaviour-preserving.
