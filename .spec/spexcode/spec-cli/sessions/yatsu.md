---
scenarios:
  - name: launch-node-binding
    tags: [backend-api]
    code: spec-cli/src/sessions.ts
    description: >-
      Through the real backend against an isolated spex-init project, create three sessions: one whose
      prompt leads with `[[<ascii-id>]]`, one with `[[<cjk-id>]]`, and one with a plain prompt naming no
      node. Read each session record's `node` and `branch`.
    expected: >-
      The first `[[<id>]]` in the prompt IS the session's node: the record binds `node` to that id (any
      script) and the branch is `node/<id>-<shortid>`. A prompt with no mention launches node-agnostic —
      `node` empty, branch derived from the prompt's own words — and is the ONLY way a launch may end up
      unbound; a mentioned node silently dropped to null is the failure this scenario watches.
---

# measuring sessions

The umbrella's own measurable seam is the launch derivation (`mentionedNode`/`titleFromPrompt` as
`newSession` consumes them): what a dispatched session gets BOUND to. Everything below it — lifecycle
states, dispatch delivery, slug identity, graph edges — is measured on the child nodes' own yatsu.
