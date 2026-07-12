---
title: spec-search
status: active
hue: 200
desc: The lexical floor of spec retrieval — `spex search <query>` ranks spec NODES by term overlap and returns {id,title,path,score,snippet}, the one return two consumers reuse.
code:
  - spec-cli/src/search.ts
related:
  - spec-cli/src/cli.ts
  - spec-cli/src/search.bench.mjs
---
# spec-search

## raw source

Build the **lexical retrieval floor** of a two-layer spec search: the agent-facing tool that, given a
natural-language question, returns the spec nodes most likely to govern the answer. BLUNT & ROBUST over
precise — minimal, elegant, purely lexical. **No embeddings, no LLM, no heuristics hand-tuned to the
benchmark.** Mirror the keyboard-nav `/` palette's ranking (title/id prefix > title/id substring > prose),
but server-side, over nodes, in TS — don't import the JSX.

One locked output contract, because two consumers reuse the SAME return: the CLI (a human reads it) and the
a downstream consumer (an agent that re-ranks it with an LLM/user-story pass, reads the winning bodies and takes their
`code:` straight from the frontmatter — feeding Explore/grep without a second index). This node builds ONLY
the floor: the lexical scorer + the `search` CLI verb + `--json`. It does NOT build the user-story rerank,
embeddings, or the ranker on top — those belong to whatever consumer sits above.

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
array above, verbatim — the machine surface a downstream consumer re-reads. `--limit`
caps the count (default 10). The scorer is CJK-aware — its tokenizer ([[shared-ranker]]) makes each Chinese
character a token, so a Chinese query reaches the CJK prose a few nodes carry (the root node's body is a whole
Chinese paragraph) with the same fielded ranking English gets, no per-language branch. A **zero-result** reply
never dead-ends: it carries the corpus-is-English fact — the corpus is overwhelmingly English, so a query in
another language that matches nothing most often just needs translating (a *hint*, not a claim that CJK is
unsupported — CJK that DOES hit corpus prose returns results, unconditional, no language sniffing) — plus a
route to the next step: the nearest node titles (`nearestTitles` — per-word normalised Levenshtein over
title+id, best-match ≥0.5 per query word then summed, top 3, reusing the same `loadSpecsLite` read, so a
transposed-`keyboard` typo still points at `keyboard-nav`; omitted when nothing is lexically near, e.g. a
pure-CJK query, whose titles are English kebab-case) and a closing `browse all: spex tree` line. The
nearest-title distance is deliberately NOT part of the ranking — it tolerates typos, the ranker must not.
Under `--json` the whole zero-result message goes to stderr so the stdout array stays verbatim. `spex help
search` states the same corpus-is-English hint, so a query that matches nothing self-explains at both surfaces.

### the ranking

The retriever (`spec-cli/src/search.ts`, `searchSpecs`) keeps the keyboard-nav palette's tier SHAPE but over
THREE fields by signal strength: **name** (`title`+`id`) > **desc** (the curated one-line summary) > **body**.
A question is many words, so the query is **tokenized** and each term scored against its single best field,
then summed. Matching is at word boundaries (prefix-of-a-word, never raw substring, so `main` can't hide in
`domain`) over a **lightly stemmed** query term — a trailing plural `s` and a mute `e` drop off, so
`sessions` reaches `session`, `merge` reaches `merging`, `declare` reaches `declaration` (query-side only;
IDF self-neutralises the extra reach). Name matches forward only; desc/body also match the reverse
(doc-word-as-prefix, ≥3 chars) so a longer doc word still reaches a shorter term. A small stoplist drops the
question's function words — deliberately tiny: quantifiers stay searchable because in this corpus they are
load-bearing ("too many owners" IS the multi-ownership concept).

Two textbook lexical weights — read FROM the corpus, never hand-fit to the benchmark — keep it robust against
this tree's biases. **IDF** (`ln(N/df)`) means a word saturating the corpus (every node is a "spec", a "node")
counts for ~nothing while rare content words carry the rank. **BM25 term-frequency** on the body means a node
that genuinely concentrates a rare word beats a long node that mentions it once — saturated and
length-normalised so neither repetition nor length runs away. The **desc tier is presence-only but
length-normalised by the same BM25 curve** (an average-length desc scores exactly the flat desc weight):
repetition inside a one-line summary is stuffing, not evidence, and without the normalisation a bloated
60-word desc catches every query term a curated one-liner can't — the cheat code that degraded recall as the
corpus grew. Together with the desc boost they reach the floor's reason to exist: the keyword in a node's
body or summary, not its title. The constants (field weights, BM25 `K1`/`B`) sit in flat plateaus, the tell
that recall is earned by the general rule, not fitted — and because they are read FROM the corpus, a plateau
can DRIFT as the tree grows: the desc weight was first re-read DOWN (3 → 2) at ~164 nodes, where sibling
nodes collide on a curated desc word and an incidental desc mention was outranking a node that genuinely
concentrates the term in its BODY; at ~173 nodes it re-read back UP a notch (to 2.2) to keep a
concept node's curated desc ahead of a same-family sibling's near-tied one. Both readings stay inside one
flat recall@3=0.875 band (W_DESC ∈ [1.85, 2.4] at the current `K1`), so each is a re-calibration to the grown
corpus, not a fit to the benchmark.

Two SHAPING RULES on top guard the same drift as the tree keeps growing and sibling names collide — both
read from the corpus, neither aimed at a case. **Name-prefix coverage:** a name hit counts by the FRACTION
of the matched name word the query term spans (floored at half — a prefix is still evidence). A full word
(`api`→`api`) is the strong signal the name tier is for; a short query term that merely PREFIXES a longer,
unrelated word (`port`→`portable-layout`, `governs`→`governed-related`) covers less of it and earns less than
a full name hit, so a sibling whose name only STARTS with a query word can no longer swallow the node that
owns the concept. **Per-term ceiling:** no single query term out-scores one full name hit (its IDF/BM25 order
the tiers only up to that ceiling). A many-word question is answered by the node that matches it BROADLY, not
by one that spikes on a single rare word it happens to carry in its NAME — the collision where a `spex
search`-named node buried "…searches specs…" or an injected-* sibling buried a concept node purely on one
uncapped name term.

It reads the spec tree from the **filesystem only** (no git walk), so a cold `spex search` is cheap to call
as freely as `grep`. `cli.ts`'s `search` verb is a thin router over `searchSpecs`; all scoring lives there so
every consumer shares one implementation. There is NO index or cache — every call re-reads and re-ranks the
whole tree (`O(Q×D)` in corpus tokens) — so it emits its pure-compute time (`nodes·tokens·ms`, excl. process
start) to stderr per call and `eval.md` tracks a baseline; nearing ~1s means an index is overdue.

Loss is the [[eval-core]]-measured recall of a held-out question→node benchmark (this node's `eval.md`), run
through the REAL `spex search --json`. It guards robustness — the ranking is iterated to lift recall WITHOUT
special-casing.
