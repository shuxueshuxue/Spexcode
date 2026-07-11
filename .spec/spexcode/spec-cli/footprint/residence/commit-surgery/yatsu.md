---
scenarios:
  - name: leak-repair-at-commit
    description: >
      Through the real product surface (planted hooks + bare git): on an adopted repo, force a leak the
      way it happens in the field — stage a CLAUDE.md blob carrying prose + the sentinel block plus a
      force-added spexcode.local.json — leave a FURTHER unstaged edit in the worktree, then run `git
      commit` with the planted pre-commit hook. Read the resulting commit, the index, and the worktree.
    expected: >
      The commit SUCCEEDS (repair, never reject) with one stderr note per repair: the committed CLAUDE.md
      blob carries the prose (staged edit included) and NO sentinel block, the machine fact is absent from
      the commit but intact on disk, and the worktree's unstaged edit is untouched (surgery sources the
      STAGED BLOB, never the worktree — partial staging survives).
    tags: [backend-api, cli]
    code: spec-cli/src/commit-surgery.ts
    related: [spec-cli/templates/hooks/pre-commit]
  - name: git-native-anchors-only
    description: >
      Prove the de-harnessing both ways: (1) edit a surface:system .config node, fire a real harness
      lifecycle event through dispatch.sh, and read whether the materialized contract moved; (2) commit the
      same edit (pre-commit anchor) and switch branches (post-checkout anchor), reading the contract after
      each.
    expected: >
      (1) The harness event materializes NOTHING — the dispatcher only dispatches; the contract file is
      byte-unchanged. (2) The commit's unconditional materialize and the post-checkout refresh each bring
      the materialized contract up to date — .config edits are git-transactional, taking effect at the git
      transition that carries them.
    tags: [backend-api, cli]
    code: spec-cli/src/commit-surgery.ts
    related: [spec-cli/hooks/dispatch.sh, spec-cli/templates/hooks/post-checkout]
---

Measured through git itself: throwaway adopted repos with the REAL planted hooks, real `git commit`/
`git checkout` as the trigger, and git's own reports (`show HEAD:file`, `show :file`, status) as the
reading. The unit suite in `spec-cli/src/materialize.test.ts` pins the same repairs at the verb level
(`spex internal commit-surgery`); the product reading goes through the hook itself.
