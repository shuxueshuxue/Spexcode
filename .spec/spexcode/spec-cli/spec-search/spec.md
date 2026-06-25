---
title: spec-search
status: active
hue: 200
desc: The lexical floor of spec retrieval — `spex search <query>` ranks spec NODES by term overlap and returns {id,title,path,score,snippet}, the one return three consumers reuse.
code:
  - spec-cli/src/search.ts
  - spec-cli/src/cli.ts
---
# spec-search

## raw source

Build the **lexical retrieval floor** of a two-layer spec search: the agent-facing tool that, given a
natural-language question, returns the spec nodes most likely to govern the answer. BLUNT & ROBUST over
precise — minimal, elegant, purely lexical. **No embeddings, no LLM, no heuristics hand-tuned to the
benchmark.** Mirror the keyboard-nav `/` palette's ranking (title/id prefix > title/id substring > prose),
but server-side, over nodes, in TS — don't import the JSX.

One locked output contract, because three consumers reuse the SAME return: the CLI (a human reads it), the
[[spec-scout]] `--deep` layer (re-ranks it with an LLM/user-story pass), and the spec→code relay (takes the
top results' `id` → `loadSpecs` → their `code:` files → feeds Explore/grep). This node builds ONLY the floor:
the lexical scorer + the `search` CLI verb + `--json`. It does NOT build `--deep`, embeddings, or the ranker
on top — those belong to [[spec-scout]].

Don't overfit. A holdout benchmark MEASURES robustness; it is not a target to game. If a case misses, prefer
a simpler general rule over a special-case — a couple of clean misses beats a gamed rule.

## expanded spec

`spex search <query> [--json] [--limit N]` is the lexical retrieval floor. It ranks over spec **nodes**
(`loadSpecs`) and returns results sorted by `score` DESC, each `{ id, title, path, score, snippet }`:

  - `id` / `title` / `path` — the node, as `loadSpecs` reports it (`path` is the repo-relative `spec.md`).
  - `score` — the summed lexical score (a positive number; only nodes that hit at least one query term
    appear). Used only for ordering; its absolute scale is not part of the contract.
  - `snippet` — a short single-line window of the node's prose (desc/body) around the first matched term,
    so a human or agent sees WHY it matched. When only the name matched, the snippet falls back to the desc.

Default output is a pretty terminal list (rank · title · id · path · snippet); `--json` prints exactly the
array above, verbatim — the machine surface that `--deep` and the spec→code relay both re-consume. `--limit`
caps the count (default 10).

### the ranking

The retriever (`spec-cli/src/search.ts`, `searchSpecs`) keeps the keyboard-nav palette's tier SHAPE — a hit
in the node's **name** (`title`+`id`) outranks a hit in its **prose** (`desc`+`body`), and a word-prefix
outranks a mid-word substring — but a question is many words where the palette took one typed fragment, so
the query is **tokenized** and each term scored independently, then summed. Matching is at word boundaries
(prefix-of-a-word, never raw substring, so `main` can't hide in `domain`); prose stems both ways
(`merge`↔`merging`) for free singular/plural reach; a small stoplist drops the question's function words.

Two textbook lexical weights — read FROM the corpus, never hand-fit to the benchmark — keep it robust against
this tree's two biases. **IDF** (`ln(N/df)`) means a word saturating the corpus (every node is a "spec", a
"node") counts for ~nothing while rare content words carry the rank. **BM25 term-frequency** on the prose tier
means a node that genuinely concentrates a rare word beats a long node that mentions it once — saturated and
length-normalised so neither repetition nor sheer length runs away. Together they reach the case the floor
exists for: the keyword living in a node's BODY, not its title — what justifies spec search over `grep` on
names. The constants (tier weights, BM25 `K1`/`B`) sit in flat plateaus, the tell that recall is earned by the
general rule, not fitted to the cases. `cli.ts`'s `search` verb is a thin router over `searchSpecs`; all
scoring lives in `search.ts` so every consumer shares one implementation.

Loss is the [[yatsu-core]]-measured recall of a held-out question→node benchmark (this node's `yatsu.md`), run
through the REAL `spex search --json`. It guards robustness — the ranking is iterated to lift recall WITHOUT
special-casing.
