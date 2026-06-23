---
scenarios:
  - name: edit-shows-uncommitted-node
    description: >-
      Through the real backend, in a worktree create a brand-new spec node whose spec.md is
      written but NOT committed (untracked), then GET `/api/edit?source=<worktree>&path=<spec.md>`
      for three paths: that untracked new node, a tracked spec.md with no pending change, and a
      tracked spec.md with an uncommitted edit. File the transcript with
      `spex yatsu eval spec-cli --scenario edit-shows-uncommitted-node --result <txt> --pass`.
    expected: >-
      The untracked brand-new node returns a NON-empty all-additions diff carrying its full
      spec.md body (not `{patch:""}`), so the overlay edit tab shows the just-created node's
      content instead of nothing; the tracked-unchanged path stays empty (no false positive);
      the tracked-edited path returns its real working-tree diff.
---
# yatsu.md — spec-cli

This node's `/api/edit` route is measured through the real backend HTTP surface (YATU): the AGENT hits the
live endpoint against a worktree holding a genuinely-untracked new node and files the transcript as a
reading. The loss being watched is the edit tab going blank for a just-created, uncommitted node — `git
diff <fork-base>` is blind to untracked files, so the contract is honoured only if the endpoint falls back
to an all-additions view for an untracked spec.md while leaving tracked paths untouched.
