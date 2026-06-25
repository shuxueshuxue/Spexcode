---
scenarios:
  - name: finds-governing-node-by-user-story
    description: >-
      SPAWN the spec-scout agent (the Agent tool, agentType spec-scout) with a behaviour question and check
      its conclusion. Use the canonical case that began the whole initiative: "does /exit clear a session's
      worktree and tmux, and how?". The agent runs `spex search --json` → reads the top candidate specs →
      reranks by user-story → `spex relay --json` for the code → returns a conclusion. Must be measured by
      ACTUALLY SPAWNING the agent (a newly-added `.claude/agents` type is not live until the harness reloads
      agent types, so it cannot be run in the session that authored it). File with
      `spex yatsu eval spec-scout --scenario finds-governing-node-by-user-story --result <txt> --pass`.
    expected: >-
      The conclusion names the governing node **session-console** (NOT a code-central node), states the
      user-story it encodes — the dashboard ❯-box intercepts `/exit` alone and runs `act('close')`, the full
      worktree+tmux cleanup, so /exit there does NOT orphan resources — and points at the code to read
      (`SessionInterface.jsx` first). It is read-only (edits nothing). If the lexical floor's top and its
      user-story judgement disagree it says which it trusts and why. This is the exact node a pure
      code-trace MISSES (the session's opening question was answered wrong from code; only the spec node
      corrected it — this agent makes that correction the cheap default).
---
# yatsu.md — spec-scout

The loss watched is **does the agent return the USER-STORY governor, not the code-central node?** Its whole
reason to exist is that `spex search`'s lexical ranking (and a plain code grep) can miss the node a user's
question is really about. The scenario measures the canonical miss — `/exit` → `session-console` — end to
end through a real spawn: search, rerank, relay, conclude. Supporting evidence already on record: the agent's
prescribed commands (`spex search` + `spex relay`) were run by hand on this query and land `session-console`
+ `SessionInterface.jsx` at rank 1; the spawn-measured reading (the agent's own reranking judgement) is filed
where the agent type is live — a future session or round-2, not the floorless authoring one.
