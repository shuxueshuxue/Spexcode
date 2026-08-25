---
scenarios:
  - name: note-cut-is-taught-once-and-kept-in-full
    tags: [cli]
    code: [spec-cli/src/session-declarations.ts]
    description: >
      From a governed session's worktree run `spex session park --note <a note longer than the table's NOTE column>`
      twice, then `spex session review <id>` and `spex session ls --json`.
    expected: >
      The first confirmation states the note's length, what the table shows, and where the full text is readable;
      the second confirmation repeats none of it; both readers return the complete note, so the table cut is
      transparent to the author and never a loss.
  - name: lost-record-diagnoses-itself
    tags: [cli]
    code: [spec-cli/src/session-declarations.ts]
    description: >
      Run `spex session ask --note x` from a directory that is not a git repository, from an unrelated repository,
      and from the right project with a wrong `--session` id.
    expected: >
      Each refusal names the cwd and the actual situation (not a repository / a project with no sessions / a store
      that lacks the id) and routes its own fix; nothing is written, and no raw git stack trace surfaces.
---
# measuring declaration

Both scenarios drive the real CLI verbs; the confirmation text and the record are the only surfaces read.
