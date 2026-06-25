---
scenarios:
  - name: retrieval-benchmark
    test: spec-cli/src/search.bench.mjs
    description: >-
      A held-out question→node benchmark MEASURING the lexical floor's robustness (NOT a target to game).
      For each of the 15 natural-language questions below, run the REAL tool — `spex search "<question>"
      --json --limit 10` — take the returned `id` list (already score-DESC), and find the rank of the first
      expected id. A case passes@k if any expected id is in the top k. Score recall@1, recall@3, and MRR
      (mean of 1/rank, 0 if absent) over all 15. The runnable harness `spec-cli/src/search.bench.mjs` drives
      exactly these calls and prints the three numbers; file its output as the reading.
      CASES (question → expected node id):
      (1) "does /exit remove the session's worktree and tmux, or just orphan them?" → session-console.
      (2) "how does an agent learn which spec governs a file it just edited?" → spec-of-file.
      (3) "what stops an agent from committing or merging straight into main?" → main-guard.
      (4) "the escape hatch that lets seeding run on the main branch" → main-guard.
      (5) "how do two running agent sessions send messages to each other?" → agent-reply-channel OR comms.
      (6) "keyboard shortcut to find a node hidden inside a collapsed subtree" → keyboard-nav.
      (7) "how is the order of sessions in the session list decided?" → session-reorder.
      (8) "what makes a node show as pending vs active vs merged vs drift?" → spec-node-states.
      (9) "how does the dashboard reach the backend API and on which port?" → api-endpoint.
      (10) "how is a node's loss measured and its scenarios scored?" → yatsu-core.
      (11) "what context gets injected into a freshly launched agent's prompt?" → injected-context.
      (12) "the one-shot nudge that makes an agent read its spec before touching code" → spec-first.
      (13) "zero-downtime backend reload without dropping connections" → supervisor.
      (14) "can several specs own the same code file, and what happens if too many do?" → governed-related.
      (15) "an injected sub-agent that searches specs for the agent, the spec analog of Explore" → spec-scout.
      Cases 4, 10, 12, 13 deliberately hide the keyword OUTSIDE the title/path — they test prose-reach (the
      whole reason spec search beats plain `grep` on titles). Lift recall by GENERALISING the ranking (IDF,
      term-frequency, stemming), never by special-casing a question.
    expected: >-
      recall@3 ≥ 0.80 over all 15 (recall@1 ≥ 0.55, MRR ≥ 0.65), achieved WITHOUT any benchmark-specific
      branch in search.ts. TWO cases are structurally unsatisfiable on the current tree and are the only
      accepted top-3 misses: (13) — the node literally named `supervisor` is the manager-agent prompt preset
      and carries NONE of "reload / zero-downtime / connections" (that mechanism's prose lives in `spec-cli`
      and `runtime`), so no purely-lexical rule can return `supervisor`; and (15) — the `spec-scout` node is
      absent here (pending-merge in another session), so it cannot be retrieved until it lands. Both resolve
      themselves as the tree fills in; neither is a reason to special-case. Among the 13 SATISFIABLE cases,
      recall@3 should be ≥ 12/13 — at most one canonical-vs-sibling ambiguity (e.g. `yatsu-core` losing to
      its siblings `spec-yatsu`/`yatsu-score-badge`, which the spec-scout `--deep` LLM layer is meant to
      break) may sit just outside the top 3.
---
# yatsu.md — spec-search

The lexical floor is measured the way a consumer uses it: through the REAL `spex search --json` surface
(YATU), never by calling `searchSpecs` with a hand-picked corpus. The loss being watched is **retrieval
robustness** — does an agent's plain-language question surface the node that actually governs the answer,
especially when the keyword sits in the body rather than the title. The benchmark is a HOLDOUT: it exists to
catch a ranking that has been bent toward a few cases, so the rule must stay general (the floor here is IDF +
BM25 term-frequency over the palette's title/id/prose tiers) and earn its recall, not pattern-match the
questions. Re-run `search.bench.mjs` after any change to `search.ts` and file the fresh numbers — a ranking
edit that lifts one case while quietly dropping two must show up in the score.
