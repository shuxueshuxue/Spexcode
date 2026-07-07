---
scenarios:
  - name: session-worktree-delivery
    description: >
      On a private-mode repo (spexcode.local.json private:true, .spec + spexcode.json untracked), create a
      session worktree the way newSession does and measure what a dispatched agent would find there: does
      the worktree carry the spec sources (.spec, spexcode.json, spexcode.local.json), does `spex board`
      from inside it see the project's nodes, and does a manual `dispatch.sh <harness> Stop` on an
      undeclared session reach the stop-gate handler (block, exit 2) instead of silently running nothing?
    expected: >
      The fresh worktree holds all three spec sources (links to the main checkout are fine), spex inside it
      sees the full node tree, and the Stop dispatch blocks with the stop-gate reason — identical to the
      default-mode behaviour. Nothing in the repo's tracked files changes.
    tags: [backend-api, cli]
    code: spec-cli/src/worktree-sources.ts
    related: [spec-cli/src/sessions.ts, spec-cli/hooks/dispatch.sh]
---

Measure through the real dispatch path, not by reading the code: a throwaway private-mode git repo (or a
live private deployment), a real `git worktree add`, then the same probes an agent's harness runs —
`dispatch.sh` with hook stdin, `spex board` from the worktree cwd. The unit test in
`spec-cli/src/materialize.test.ts` covers the link mechanics; this scenario is the product-level loop.
