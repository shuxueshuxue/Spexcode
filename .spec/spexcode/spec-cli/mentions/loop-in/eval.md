---
scenarios:
  - name: cli-originator-courtesy
    tags: [cli, backend-api]
    code: spec-cli/src/loop-in.ts
    related: [spec-cli/src/issues-cli.ts, spec-cli/src/mentions.ts, spec-cli/src/sessions.ts]
    description: >-
      In an isolated adopted Git repository, start a real SpexCode backend with the no-model fake harness and
      create online originator and replier sessions. With those session identities, use the real `spex issue`
      CLI to open a local thread as the originator and reply as the replier, then read the CLI receipt, the
      originator's live capture, the issue JSON, and the session list. `loop-in` has no standalone CLI verb;
      `spex issue reply` is its user-facing reply entry point.
    expected: >-
      The reply commits and the CLI receipt names exactly one online originator courtesy. The originator's
      capture contains the courtesy text and reply body; the stored thread contains the ordinary reply by the
      replier; no third session is created or contacted. The notification is a copy only: it neither changes
      the thread's lifecycle nor turns the recipient into an assignee.
---

# measuring loop-in

YATU uses the real `spex issue reply` command, the user-facing gate into `replyIssueWithLoopIn`, rather than
calling the composer or delivery selector directly. A disposable backend and fake harness make the recipient's
actual session surface observable without a model or network; the captured CLI transcript records the write,
courtesy receipt, recipient delivery, persisted thread, and no-spawn control together.
