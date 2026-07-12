---
scenarios:
  - name: retrieval-benchmark
    tags: [cli]
    test: spec-cli/src/search.bench.mjs
    description: >-
      A held-out question→node benchmark MEASURING the lexical floor's robustness (NOT a target to game).
      For each of the 16 natural-language questions below, run the REAL tool — `spex spec search "<question>"
      --json --limit 10` — take the returned `id` list (already score-DESC), and find the rank of the first
      expected id. Labels are node LEAF names matched with the SAME de-collision rule the loader applies
      (specs.ts reId): a returned id hits a label if it IS the label or ends with `_<label>`, so a bare leaf
      keeps matching after collision-qualification renames it (e.g. a colliding `probe` leaf →
      `a_probe`); a label may be written pre-qualified to pin one collision branch. A case
      passes@k if any expected id is in the top k. Score recall@1, recall@3, and MRR (mean of 1/rank, 0 if
      absent) over all 16. The runnable harness `spec-cli/src/search.bench.mjs` drives exactly these calls
      and prints the numbers; file its output as the reading.
      CASES (question → expected node leaf):
      (1) "does /exit remove the session's worktree and tmux, or just orphan them?" → session-console.
      (2) "how does an agent learn which spec governs a file it just edited?" → spec-of-file.
      (3) "what stops an agent from committing or merging straight into main?" → main-guard.
      (4) "the escape hatch that lets seeding run on the main branch" → main-guard.
      (5) "how do two running agent sessions send messages to each other?" → agent-reply-channel OR comms.
      (6) "keyboard shortcut to find a node hidden inside a collapsed subtree" → keyboard-nav.
      (7) "how is the order of sessions in the session list decided?" → session-console (the dedicated
      session-reorder node was merged away when the console dropped drag-reorder; ordering now lives in
      session-console's two-zone/newest-first prose).
      (8) "what makes a node show as pending vs active vs merged vs drift?" → spec-node-states.
      (9) "how does the dashboard reach the backend API and on which port?" → api-endpoint.
      (10) "how is a node's loss measured and its scenarios scored?" → eval-core.
      (11) "what context gets injected into a freshly launched agent's prompt?" → injected-context.
      (12) "the one-shot nudge that makes an agent read its spec before touching code" → spec-first.
      (13) "zero-downtime backend reload without dropping connections" → supervisor.
      (14) "can several specs own the same code file, and what happens if too many do?" → governed-related.
      (15) "an injected sub-agent that searches specs for the agent, the spec analog of Explore" → spec-search
      (re-labelled 2026-07-12: the original target spec-scout was retired end to end by human ruling — the
      agent now runs the search itself per the contract block, so the lexical surface inherited the intent).
      (16) "how does a worker declare it is done" → state (regression: a live miss caught 2026-07-06 —
      eval-proactive sat #1 off an incidental desc word while the lifecycle governor sat #5).
      PLUS two non-rank zero-result regressions (the reply must route to a next step, never dead-end):
      (a) run `spex spec search "会话"` (会/话 appear NOWHERE in the corpus — no --json) — zero results MUST print
      the corpus-is-English translate-and-retry fact AND the `browse all: spex graph` line (no nearest
      titles — CJK has nothing to be lexically near); a Chinese query that DOES hit corpus prose is the
      separate [[cjk-retrieval]] scenario; (b) run `spex spec search "kyeboard"` — zero results MUST
      print a `nearest titles` list containing `keyboard-nav` (per-word edit-distance fallback) AND the
      `spex graph` line.
      Cases 4, 10, 12, 13 deliberately hide the keyword OUTSIDE the title/path — they test prose-reach (the
      whole reason spec search beats plain `grep` on titles). Lift recall by GENERALISING the ranking (fielded
      name>desc>body weighting, IDF, BM25 term-frequency, stemming), never by special-casing a question.
    expected: >-
      recall@3 ≥ 0.875 (14/16) with recall@1 ≥ 0.50, MRR ≥ 0.65, and BOTH zero-result checks PASS (cjk:
      corpus-is-English fact + spex-graph pointer; typo: nearest-titles incl. keyboard-nav + spex-graph
      pointer), achieved WITHOUT any benchmark-specific branch in search.ts/ranker.ts. EXACTLY TWO cases are accepted
      misses, both label-vs-prose limits no purely-lexical rule can bridge, left as holdouts rather than
      special-cased: (13) the node literally named `supervisor` is the manager-agent prompt preset and
      carries NONE of "reload / zero-downtime / connections" (that mechanism's prose lives in `spec-cli`,
      which the floor returns at rank 2); (7) session ordering is one sentence inside session-console's
      ~3200-word body while a sibling carries `ordering` in its NAME (nav-mode-key-ordering, lexically
      indistinguishable). All other 14 cases sit in the top 3 — the few not at #1 (e.g. `api-endpoint`,
      `eval-core`, `governed-related` vs its remedy-sibling `regroup`) are canonical-vs-sibling ties a
      downstream LLM re-rank layer (none exists since spec-scout's retirement) would break; being inside the top 3 is the floor doing its job.
      Measured 2026-07-09 at 164 nodes after re-calibrating the desc tier weight (W_DESC 3 → 2) — the
      recall@3 had drifted to 0.813 (below this floor) as the corpus grew and incidental desc mentions began
      outranking body concentration; lowering the desc tier restored it: recall@1 0.625, recall@3 0.875,
      MRR 0.747, cjk-positive PASS, cjk-hint PASS, typo-route PASS. (Prior: recall@1 0.563, recall@3 0.875,
      MRR 0.705 at 153 nodes / W_DESC 3, before the corpus-growth drift.)
  - name: search-compute-budget
    tags: [cli]
    test: spec-cli/src/search.bench.mjs
    description: >-
      Track the floor's PURE search-compute time. The floor has NO index or cache — every call re-reads and
      re-ranks the whole tree, O(Q×D) in the corpus token count — so this measures whether that recompute
      stays cheap as the tree grows. Run `spex spec search "<any question>"` and read the stderr line
      `[spec-search] compute <ms>ms · <nodes> nodes · <tokens> tokens`: that ms is the floor's compute only
      (loadSpecsLite read+parse + rankDocs's tokenize/IDF/BM25), excluding process boot and the lazy import.
      File the number against the current corpus scale.
    expected: >-
      Pure compute stays comfortably under ~1s — baseline ~70ms at ~81 nodes / ~40k tokens, where the
      loadSpecsLite read+parse (and the O(N²) id de-collision) dominate, NOT the ranking; ~105ms at 150
      nodes / ~104k tokens (2026-07-06, incl. the stem + desc-norm additions), still on the O(corpus) line.
      Because the cost is O(corpus) with no index, the alarm is the day it nears ~1s: that is when a cached
      parse / inverted index is overdue (the spec names this). A regression at fixed node count (say 2× the
      baseline) means the recompute or the FS read grew — investigate before it reaches the wall.
  - name: cjk-retrieval
    tags: [cli]
    test: spec-cli/src/search.bench.mjs
    description: >-
      Chinese-language retrieval. The corpus is overwhelmingly English, but a handful of nodes carry CJK
      prose — the root `spexcode` node's body is a full Chinese paragraph describing the node-graph. The
      tokenizer must therefore treat CJK, not only `[a-z0-9]`: each Han/kana character is its own token (a
      unigram), so a Chinese query reaches the CJK content the same fielded name>desc>body + IDF + BM25
      machinery ranks English with — one shared rule, no per-language branch. Two checks through the REAL
      `spex spec search`: (a) `spex spec search "节点" --json` must return `spexcode` (the root node repeats 节点
      throughout its body) in the top results — a Chinese content word finds the node whose prose carries it;
      (b) `spex spec search "会话"` (会/话 appear NOWHERE in the corpus) must still return zero results and print
      the corpus-is-English translate-and-retry fact + the `browse all: spex graph` line — CJK support does
      NOT suppress the honest zero-result route when a query genuinely matches nothing. This same tokenizer
      lives in the shared [[shared-ranker]] core, so the dashboard search palette gains CJK over its
      (often-Chinese) session/issue planes for free.
    expected: >-
      (a) `spex spec search "节点"` returns `spexcode` at rank 1 (its body concentrates 节/点 and the CJK IDF is
      high because few nodes carry any CJK); (b) `spex spec search "会话"` returns zero results WITH the
      corpus-is-English hint + `spex graph` pointer. Both achieved by the general per-CJK-character tokenizer,
      no benchmark-specific branch. Filed via search.bench.mjs's cjk-positive + cjk-zero-result checks.
---
# eval.md — spec-search

The lexical floor is measured the way a consumer uses it: through the REAL `spex spec search --json` surface
(YATU), never by calling `searchSpecs` with a hand-picked corpus. The loss being watched is **retrieval
robustness** — does an agent's plain-language question surface the node that actually governs the answer,
especially when the keyword sits in the body rather than the title. The benchmark is a HOLDOUT: it exists to
catch a ranking that has been bent toward a few cases, so the rule must stay general (the floor here is a
fielded name>desc>body weighting with IDF + BM25 body term-frequency, a length-normalised presence desc
tier, and a light query-side stem, reading the tree from the filesystem only so it stays cheap to call) and
earn its recall, not pattern-match the questions. Benchmark LABELS age with the tree: they are leaf names
resolved through the loader's de-collision rule, and when a node is merged away its case is re-labelled to
the node that inherited the intent (never deleted to flatter the score). Re-run `search.bench.mjs` after any
change to `search.ts`/`ranker.ts` and file the fresh numbers — a ranking edit that lifts one case while
quietly dropping two must show up in the score.
