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
      the session conversation/timeline. Sending leaves the reader on the file they commented on, so the delivery
      marker is visible where it was filed. Editing a sent comment clears sentAt and the edited body is not silently
      replayed. Retracting a row removes it from the record and the diff — including an already-sent row, whose
      delivered message is NOT recalled — and retracting one that is already gone is refused rather than silently
      accepted.
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
      The panel names every changed file under its directory, with counts. Exactly one file's diff is mounted — the
      selected one — under a header naming it. Split mode renders two read-only CodeMirror panes with old/new line
      numbers and visible changed text, and both panes sit inside the editor's own width — the new side is never
      pushed outside the scroll container, so the split editor's scrollWidth does not exceed its clientWidth at
      desktop width. Unified mode renders one pane with original content above new content, syntax-highlights
      deletions, and keeps the same selected file. Changed lines carry a tint that reads against the surface in both
      modes, and unchanged context around a change is shown rather than folded to a hairline. Controls change only
      the editor presentation and never the session route; no accept/reject control or second transport appears.
    code:
      - spec-dashboard/src/DiffDocument.jsx
      - spec-dashboard/src/styles.css
      - spec-dashboard/package.json
  - name: collapse-all-file-tree
    tags: [frontend-e2e, desktop]
    description: >-
      Open a multi-file session diff with its changed-file panel expanded, activate the panel's Collapse All
      control, then reopen one directory and select a file.
    expected: >-
      The panel exposes one accessible Collapse All icon action above the committed and uncommitted scopes.
      Activating it hides every directory child while leaving the selected file and diff document mounted; the
      button becomes inert with no folders open. Reopening an individual directory reveals only that branch and
      selecting its file changes the existing diff surface without a route or transport change.
    code:
      - spec-dashboard/src/DiffDocument.jsx
      - spec-dashboard/src/styles.css
  - name: changed-file-labels-stay-distinguishable
    tags: [frontend-e2e, desktop]
    description: >-
      Open the diff of a session whose changed files are deep spec-graph paths that share a long prefix and repeat
      the same leaf name. Read every row the changed-file panel renders, and read the open file's header at a
      desktop width and at a width narrow enough to force the header to truncate.
    expected: >-
      No row's label is the shared prefix with its distinguishing tail cut off, and a single-child directory chain
      appears as one row carrying the whole chain. A row is identified by its label under its visible ancestors, so
      the measurable claim is that SIBLINGS never share a label — a repeated leaf name like `spec.md` under
      different directories is correct, a repeated one under the same directory is not. Every row carries its
      untruncated path as a tooltip. Where the header has to truncate it drops the FRONT of the path, keeps the
      file name whole at any width, and marks that it truncated.
    code:
      - spec-dashboard/src/diffTree.js
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
