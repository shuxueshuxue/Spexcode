---
title: comment-altitude
surface: system
status: active
hue: 200
desc: A config plugin — code comments navigate non-obvious local reasoning; specs own product intent and contract.
---
Specs own intent, invariants, policy, and observable contracts. Comments only navigate non-obvious local decisions.

1. Contract or intent belongs in the owning spec body, not a code comment.
2. Keep a short nearby comment for ordering, platform behavior, measured pitfalls, or why a plausible alternative
   is unsafe.
3. Delete commentary that only translates code or repeats a name/type.

Do not delete measured values, version-specific behavior, or rejected alternatives that are not in the spec.
`@@@title - explanation` is reserved for genuinely tricky surviving local reasoning.
