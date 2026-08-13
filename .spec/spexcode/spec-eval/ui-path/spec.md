---
title: eval UI path classifier
status: active
hue: 140
desc: The single frontend-path classifier used by session evaluation to identify surfaces that require browser proof.
code:
  - spec-eval/src/ui-path.ts
---
# eval UI path classifier

`ui-path.ts` owns the frontend-specific `isUiPath` predicate used by session evaluation. The CLI module only
re-exports it for its scan tests and public compatibility; there is no second classifier or UI policy in the CLI.
