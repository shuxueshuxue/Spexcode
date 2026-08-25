---
scenarios:
  - name: merged-branch-empty-state-is-honest
    tags: [frontend-e2e, desktop, backend-api]
    code: [spec-dashboard/src/DiffDocument.jsx, spec-cli/src/sessions.ts]
    description: >-
      Open the diff of three retained sessions whose merge-base file list is empty: one whose branch never
      authored a commit of its own (its head still stands at the fork point), one whose branch head is already
      reachable from main, and one unmerged control. Read the header refs, object ids, empty-state sentence,
      and commit target of each.
    expected: >-
      The header prints the complete branch and base names plus full head/base ids. Each session gets the
      sentence that is true of it: the branch that never authored a commit says exactly that and offers no
      forge commit link; the landed branch says its work is merged into main and links its head as a real
      forge commit when origin supports one; the unmerged control keeps the no-branch-changes sentence. A
      branch that never authored a commit is never told its work merged.
  - name: branch-diff-comment-roundtrip
    tags: [frontend-e2e, desktop, backend-api]
    description: >-
      Open a real session's `surface=diff` document, observe the per-file branch diff, add a line comment, send it
      to the agent, and open the conversation surface to confirm the formatted comment is delivered in the session
      timeline. Screenshot the diff and sent comment with `spex eval add diff-document --scenario
      branch-diff-comment-roundtrip --image <png> --pass`.
    expected: >-
      The diff document loads without an extra navigation model, files are read-only and line-addressed, the saved
      comment is visible inline as unsent, sending marks it sent exactly once, and the same review text appears in
      the session conversation/timeline. Editing a sent comment clears sentAt and the edited body is not silently
      replayed.
    code:
      - spec-dashboard/src/DiffDocument.jsx
      - spec-cli/src/sessions.ts
  - name: split-unified-diff-reading
    tags: [frontend-e2e, desktop, backend-api]
    description: >-
      Open a controlled multi-file session diff through the real browser surface. Use the changed-file panel to
      select a file, inspect the default split view, switch to unified view, toggle wrapping, and move through the
      hunk controls. Measure the settled desktop geometry of the split editor against its own scroll container.
    expected: >-
      The file panel names every changed file with its status and counts. Split mode renders two read-only
      CodeMirror panes with old/new line numbers and visible changed text, and both panes sit inside the editor's
      own width — the new side is never pushed outside the scroll container, so the split editor's scrollWidth does
      not exceed its clientWidth at desktop width. Unified mode renders one pane with original content above new
      content, syntax-highlights deletions, and keeps the same selected file. Changed lines carry a tint that reads
      against the surface in both modes. Controls change only the editor presentation and never the session route;
      no accept/reject control or second transport appears.
    code:
      - spec-dashboard/src/DiffDocument.jsx
      - spec-dashboard/src/styles.css
      - spec-dashboard/package.json
  - name: uncommitted-work-is-visible
    tags: [frontend-e2e, desktop, backend-api]
    description: >-
      Open the diff of a live session that has edited tracked files and added an untracked one without committing,
      and the diff of a session whose worktree directory is gone. Read the changed-file panel's groups, open one
      uncommitted file, and compare the group against `git status --porcelain --untracked-files=all` run in that
      worktree.
    expected: >-
      The uncommitted group names exactly the paths git reports dirty — tracked edits and untracked additions
      alike — each with its status and line counts, kept separate from the committed branch group, and opening one
      renders its real patch. A session whose worktree directory is gone shows the committed branch alone and
      never claims its working tree is clean.
    code:
      - spec-cli/src/sessions.ts
---
