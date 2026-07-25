---
scenarios:
  - name: spawner-clause-points-and-stays-quiet
    tags: [backend-api]
    test:
      path: spec-cli/src/sessions.test.ts
      name: the spawner pointer names the parent worktree and stays quiet without one
    description: >-
      Build a spawner record through the real on-disk `fromRaw` shape — worktree path, branch, and label —
      and compose the launch-prompt clause from it. Then compose it with no parent at all, and with a parent
      record whose worktree path is empty.
    expected: >-
      With a spawner, the clause leads with a blank line so it appends after the spec pointer instead of
      running into it, names the spawner's short id, its label, its worktree path and its branch, states that
      the child's own worktree is branched from the base and therefore does not contain that work, and carries
      the read-only instruction. It stays a pointer — no spec body. With no parent, and with a parent record
      carrying no worktree, the clause is the empty string.
---
# eval.md — spawner-pointer

The loss watched here is the pointer's two halves: it must carry **enough** for the child to find the
spawner's tree (id, path, branch, and the reason its own tree lacks that work), and it must add **nothing**
when there is no spawner to point at — the same fail-quiet rule [[spec-pointer]] follows, so a top-level
launch's prompt is byte-identical to what it was before this injection existed.

The clause is a pure function of the spawner's record, so the scenario measures it directly rather than
through a live dispatch: what a real launch appends is this string, and the record it reads is the same one
the board renders.
