---
scenarios:
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
---
