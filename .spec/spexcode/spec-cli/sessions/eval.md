---
scenarios:
  - name: launch-node-binding
    tags: [backend-api]
    code: spec-cli/src/sessions.ts
    description: >-
      Through the real backend against an isolated spex-init project, first POST a stale explicit `node`
      field and confirm it is rejected without creating a session. Then create sessions whose raw prompts
      cover two mentions (ASCII first), a CJK id, a leading-dot `.plugins` id, a nonexistent id, and no
      mention. Read `node` and `branch` from `/api/sessions` and `/api/graph`, and inspect each generated
      launch script for the spec pointer.
    expected: >-
      `node` is not an accepted create field. The first `[[<id>]]` in the prompt is the ONLY binding input:
      the record and board bind `node` to that exact id (any script, optional leading dot, existence not
      required) and the branch is `node/<id>-<shortid>`. An existing id gets one live-worktree spec pointer;
      a nonexistent id gets none. A prompt with no mention launches node-agnostic — `node` empty, branch
      derived from the prompt's own words — and is the only way a launch may end up unbound.
---

# measuring sessions

The umbrella's own measurable seam is the launch derivation (`nodeFromPrompt`/`titleFromPrompt` as
`newSession` consumes them): what a dispatched session gets BOUND to. Everything below it — lifecycle
states, dispatch delivery, slug identity, graph edges — is measured on the child nodes' own yatsu.
