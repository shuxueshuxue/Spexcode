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

`spex search <query> [--json] [--limit N]` is the lexical retrieval floor. It ranks over spec **nodes** and
returns results sorted by `score` DESC, each `{ id, title, path, score, snippet }`:

  - `id` / `title` / `path` — the node (`path` is the repo-relative `spec.md`).
  - `score` — the summed lexical score (positive; only nodes hitting ≥1 query term appear). Ordering only;
    its absolute scale is not part of the contract.
  - `snippet` — a short one-line window of the node's prose around the first matched term, so the reader sees
    WHY it matched (falls back to the desc when only the name matched).

Default output is a pretty terminal list (rank · title · id · path · snippet); `--json` prints exactly the
array above, verbatim — the machine surface that `--deep` and the spec→code relay both re-consume. `--limit`
caps the count (default 10).

### the ranking

The retriever (`spec-cli/src/search.ts`, `searchSpecs`) keeps the keyboard-nav palette's tier SHAPE but over
THREE fields by signal strength: **name** (`title`+`id`) > **desc** (the curated one-line summary) > **body**.
A question is many words, so the query is **tokenized** and each term scored against its single best field,
then summed. Matching is at word boundaries (prefix-of-a-word,
never raw substring, so `main` can't hide in `domain`); name matches forward only (else the plural `specs`
floods every `spec-*` node), desc/body stem both ways (`merge`↔`merging`) for free singular/plural reach; a
small stoplist drops the question's function words.

Two textbook lexical weights — read FROM the corpus, never hand-fit to the benchmark — keep it robust against
this tree's biases. **IDF** (`ln(N/df)`) means a word saturating the corpus (every node is a "spec", a "node")
counts for ~nothing while rare content words carry the rank. **BM25 term-frequency** on the body means a node
that genuinely concentrates a rare word beats a long node that mentions it once — saturated and
length-normalised so neither repetition nor length runs away. Together with the desc boost they reach the
floor's reason to exist: the keyword in a node's body or summary, not its title. The constants (field weights,
BM25 `K1`/`B`) sit in flat plateaus, the tell that recall is earned by the general rule, not fitted.

It reads the spec tree from the **filesystem only** (no git walk), so a cold `spex search` is cheap to call
as freely as `grep`. `cli.ts`'s `search` verb is a thin router over `searchSpecs`; all scoring lives there so
every consumer shares one implementation. There is NO index or cache — every call re-reads and re-ranks the
whole tree (`O(Q×D)` in corpus tokens) — so it emits its pure-compute time (`nodes·tokens·ms`, excl. process
start) to stderr per call and `yatsu.md` tracks a baseline; nearing ~1s means an index is overdue.

Loss is the [[yatsu-core]]-measured recall of a held-out question→node benchmark (this node's `yatsu.md`), run
through the REAL `spex search --json`. It guards robustness — the ranking is iterated to lift recall WITHOUT
special-casing.
