---
scenarios:
  - name: no-node-fallback-finds-the-governing-node
    tags: [backend-api]
    description: >-
      The full grounding closed loop, through the real hook + CLI (YATU). For a session whose global
      record carries NO `node:` line (a session not bound to one node), run spec-first.sh on a
      first code-file access (sentinel absent) and capture its JSON decision; then run
      `spex spec search "<topic for that code area>" --json` against the same tree. File the transcript with
      `spex eval add inject-spec-first --scenario no-node-fallback-finds-the-governing-node --pass --result <txt>`.
      Must be measured where the spec-search floor is present (the integration branch), not on a floor-less node branch.
    expected: >-
      The hook returns `decision:block`, and its no-node fallback now reads `run: spex spec search <topic>` (the
      old `spex graph --json` whole-tree dump replaced by the retriever); and `spex spec search` returns the area's
      governing node at rank 1. So a session with no assigned node is sent to a search that actually lands on
      the right contract — the loop closes: first code access blocked → told to `spex spec search` → search hits
      the governing node, instead of being told to eyeball the whole board.
  - name: codex-multi-file-access
    tags: [cli]
    description: >-
      Feed the real spec-first hook one adapter-shaped access containing both a spec path and a code path,
      as a Codex multi-file patch does, with no prior sentinel. Then repeat with only spec paths.
    expected: >-
      The mixed access emits decision:block because every resolved path is considered and at least one is
      code. The spec-only access stays silent and writes the sentinel. A later path in one patch can neither
      bypass grounding nor be lost behind the first path.
---
# eval.md — spec-first

The loss watched here is the **no-node grounding fallback**. When a session is bound to one node, spec-first
points straight at that node's `spec.md`; when it is NOT, the reminder must still hand the agent a way to
*find* its contract. The old fallback said "run `spex graph --json`" — a whole-tree dump the agent must eyeball.
This scenario measures the upgraded fallback end to end: the hook now points at `spex spec search <topic>`
([[spec-search]]), and that search must actually return the governing node at the top — otherwise the
fallback sends the agent somewhere that doesn't close the loop. Measured against the live hook and the live
`spex spec search`, never a stub.
