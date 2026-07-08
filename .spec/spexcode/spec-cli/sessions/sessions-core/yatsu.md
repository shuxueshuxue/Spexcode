---
scenarios:
  - name: slug-own-identity
    tags: [cli]
    description: >
      Run the real slug/title derivation newSession uses (sessions.ts) over three launch prompts:
      one that @-mentions another session's id in otherwise-CJK prose
      (`清理一下 @ce5362f3-ceb4-4f77-988f-197df214b15d`), one that is pure CJK (`清理一下`), and a
      mixed CJK/ASCII prompt carrying a session mention. Read the slug/branch each would get.
    expected: >
      No derived slug/branch ever contains a mentioned session id or any UUID-shaped token — a
      session can never wear another session's identity on its branch/worktree (the collision that
      lets a cleanup worker match its own worktree). CJK words survive into a meaningful unicode
      slug instead of being dropped; a prompt that is nothing but a mention still yields the
      non-empty unique `session-<shortid>` fallback.
    test: spec-cli/src/sessionSlug.test.ts
---

# sessions-core — measurement

YATU: derive through the exported seam `newSession` actually calls (`titleFromPrompt` + `slugify`
in `sessions.ts`), not a re-derivation — the unit test in `sessionSlug.test.ts` drives exactly
those exports and is the runnable form of the scenario; file its transcript as `--result`.
