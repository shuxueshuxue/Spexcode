---
scenarios:
  - name: caller-routed-reply-round-trip
    tags: [cli]
    code: [spec-cli/src/issues-cli.ts#runIssueWrite]
    related: [spec-dashboard/src/Thread.jsx#ReplyComposer]
    description: >-
      In a disposable adopted Git repository with SPEXCODE_ISSUES_DIR pointed at a disposable directory,
      create a local issue with the real `spex issue open` command, then reply through `spex issue reply`
      using stdin. Read the same thread through `spex issue show --json`, and attempt a reply to an
      unknown local id. Capture every command's stdout, stderr, and exit status.
    expected: >-
      The caller-routed reply command exits 0, reports the local thread and its one post, and `show --json`
      returns the exact authored reply as the thread's sole reply, including a literal @session reference.
      An unknown local id exits nonzero with an actionable missing-thread error; it never succeeds silently
      or creates a second thread. This CLI scenario proves the delivery boundary only; real browser scenarios
      remain the evidence for the shared Thread.jsx rendering surface.
---

# reply-thread — measurement method

Measure the delivery boundary through the real `spex issue` CLI in a disposable adopted repository and
disposable issue store. The transcript proves caller-routed persistence only; it is not substituted for
browser evidence of the shared dashboard component.
