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
      required) and the branch is `node/<slug(id)>-<shortid>` (`.plugins` binds exactly but slugs to
      `plugins`). An existing id gets one live-worktree spec pointer;
      a nonexistent id gets none. A prompt with no mention launches node-agnostic — `node` empty, branch
      derived from the prompt's own words — and is the only way a launch may end up unbound.
  - name: zcode-child-eval-identity
    tags: [backend-api]
    test: spec-cli/src/session-zcode-child-session.api.test.ts
    code: [spec-cli/src/sessions.ts, spec-cli/src/index.ts, packages/spec-core/src/layout.ts]
    description: >-
      Through an isolated live backend with two governed ZCode session records, prime `/api/graph`, then
      POST one native opaque child id to the first owner's `zcode-child-sessions` route. Read the graph
      again without restarting. Repeat the pair, attempt the same child against the second owner, and
      finally remove the first owner record before binding the child to the second.
    expected: >-
      The initial graph omits `zcodeChildSessionIds`; the first declaration returns 201 and its exact child
      appears only on the first owner's next graph row without a restart. The repeated pair returns 200;
      rebinding a still-owned child fails 409 without changing the first row; malformed input fails 400 and
      an unknown owner fails 404. Removing the owner record removes its association, after which the second
      owner may create the exact binding. No title, branch, worktree, or timestamp is used as a fallback.
---

# measuring sessions

The umbrella measures public backend relations that an owning session declares. Launch derivation
(`nodeFromPrompt`/`titleFromPrompt` as `newSession` consumes them) is one seam; the exact native-child to
session-eval association is another. Everything else — lifecycle states, dispatch delivery, slug identity,
graph edges — is measured on the child nodes' own yatsu.
