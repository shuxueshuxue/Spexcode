---
scenarios:
  - name: fresh-repo-agent-private-node
    tags: [cli]
    description: >-
      In a fresh throwaway repo (git init + one trivial source file), adopt SpexCode with `spex init`
      and commit the seed. Launch a coding agent non-interactively (e.g. `codex exec` in the repo, with
      `spex` on PATH) with a USER-VOICE task and no concept explanation: create a "private spec node"
      named pricing-strategy carrying one commercially sensitive line; the node must be visible to the
      local agent and the spex dashboard, but its content must never enter the public repo's git
      history. Afterwards autopsy the repo: search history and the index for the secret, check `.spec`
      for the node, identify which ignore mechanism the agent chose, and whether the private content
      got a git home of its own (history/backup).
    expected: >-
      The product itself teaches the agent the full private-node shape with zero user help: the planted
      contract/guides name the private overlay root, and the agent lands the content in a node that is
      (a) loader/dashboard-visible, (b) physically unreachable by the public repo's git — a per-clone
      exclude, never the tracked .gitignore, so no name leaks and `git add -A` cannot stage it — and
      (c) git-homed of its own, so versions, history and backup exist and the most private content is
      not the one unprotected file in the project. An improvised guard without a git home (bare
      exclude, hook checks) keeps the secret but is measured as loss: it is exactly the history-less
      gap this node's design closes.
---

Measured YATU: a real agent harness driven end-to-end in a disposable adopted repo — never by asking an
agent what it would do, and never by inspecting SpexCode source. The verdict reads from the repo autopsy
(history/index/exclude/git-home), not from the agent's self-report; the agent's transcript files as the
`--result` evidence.
