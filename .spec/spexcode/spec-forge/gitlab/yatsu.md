---
scenarios:
  - name: real-gitlab-listing
    description: >
      From a repo whose origin remote is a GitLab host (the reference target: z-code at
      dev.aminer.cn, reached from the machine that holds its PAT in git's credential store, with
      no GITLAB_TOKEN exported — so the credential-store path is what's exercised), run
      `spex forge links --host gitlab`. Separately probe the driver's listPRs and listIssuesSince
      shapes against the same host.
    expected: >
      The header reports a non-zero scan of real issues and merge requests, and marker-linked
      issues resolve to real spec nodes with per-project `#iid` numbers, `open` state (never
      `opened`), and host web URLs. An MR maps its source branch to headRefName; the incremental
      window returns only recently-updated issues, with non-system notes mapped to comments
      (author, ISO createdAt, body). No token/config editing is needed on a machine that can
      already push to the host.
    tags: [cli]
---
# gitlab — measurement

YATU through the real CLI: the same `spex forge links --host gitlab` a human runs, from a real
GitLab-hosted repo, authenticated only by what a `git push` there already uses. The transcript is
the evidence — header counts, resolved nodes, and the raw driver shapes for MRs and the
since-window. Reasoning about the mapping code is not a measurement.
