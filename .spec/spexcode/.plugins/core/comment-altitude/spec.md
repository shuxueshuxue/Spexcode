---
title: comment-altitude
surface: system
status: active
hue: 200
desc: A config plugin — code comments navigate non-obvious local reasoning; specs own product intent and contract.
---
Code comments are navigation aids, not a second specification. The owning spec body is the current contract:
intent, invariants, externally observable behavior, and product policy belong there once, rather than being
restated beside each implementation.

Before retaining or adding a comment, ask in this order:

1. Does it state intent or a contract? Put that fact in the owning spec body if it is not already there, then
   remove the code comment.
2. Does it explain a non-obvious local decision — ordering, a platform or library behavior, a measured pitfall,
   or why an otherwise plausible implementation is unsafe? Keep a short comment beside the decision. It should
   name the fact the reader cannot recover from code alone, not re-explain the whole feature.
3. Does it merely translate the next line or restate a type/name? Remove it.

Never turn subtraction into amnesia. A measured value, version-specific behavior, rejected alternative, or other
implementation fact absent from the spec must remain in code unless it is truly product contract, in which case
move the fact to the spec before deleting the comment. `@@@title - explanation` is reserved for the genuinely
tricky local reasoning that survives this test; a tag is not a license to repeat the spec.

This division gives each information channel one repair path: a changed product promise updates its spec; a changed
implementation hazard updates its nearby comment; code that makes either false updates both as their distinct facts
require. The rule complements [[spec-first]]: reading the contract first is what makes redundant code prose visible.
