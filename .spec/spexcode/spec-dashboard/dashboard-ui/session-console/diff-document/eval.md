---
scenarios:
  - name: merged-branch-empty-state-is-honest
    tags: [frontend-e2e, desktop, backend-api]
    code: [spec-dashboard/src/DiffDocument.jsx, spec-cli/src/sessions.ts]
    description: >-
      Open the diff of a retained session whose branch head commit is already reachable from main and whose
      merge-base diff is empty. Read the header refs, object ids, empty-state sentence, and commit target.
    expected: >-
      The header prints the complete branch and base names plus full head/base ids. The empty state says the
      branch head is merged into main and the head is a real forge commit link when origin supports one; it
      never says no branch changes. An unmerged genuinely-empty control keeps the no-changes sentence.
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
      Open a controlled two-file session diff fixture through the real browser surface. Use the changed-file panel
      to select a file, inspect the default split view, switch to unified view, toggle wrapping, and move through
      the hunk controls. Capture the settled desktop view and selected-file geometry.
    expected: >-
      The file panel names every changed file with its status and counts. Split mode renders two read-only CodeMirror
      panes with old/new line numbers and visible changed text; unified mode renders one pane with original content
      above new content, syntax-highlights deletions, and keeps the same selected file. Controls change only the
      editor presentation and never the session route; no accept/reject control or second transport appears.
    code:
      - spec-dashboard/src/DiffDocument.jsx
      - spec-dashboard/src/styles.css
      - spec-dashboard/package.json
---
