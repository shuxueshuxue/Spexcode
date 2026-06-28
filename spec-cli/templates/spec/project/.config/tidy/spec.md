---
title: tidy
surface: command
status: active
hue: 140
desc: Rewrite a node's body to contract altitude — push mechanics into code comments, keep the contract, without going vague.
kind: mutating
---
Tidy each target spec node so its body reads as **contract**, not implementation — and not vague hand-waving either.

{{targets}}

The objective rule for every sentence is the contract-surface test: *"could a behavior-preserving refactor delete or change this?"*

- **Yes ⇒ it is implementation.** It leaves the body and becomes an `@@@title - explanation` comment at the code that owns it (operators, call names, data structures, "added a parameter", step-by-step how-to).
- **No ⇒ it is contract surface.** Keep it — public names, signatures, return types, invariants, edges/errors, the WHEN → outcome a caller observes.

For each target, in its own commit:

- **Preserve the contract** — never drop a requirement; tidying is rephrasing at the right altitude, not deletion of meaning.
- **Raise, don't hollow out** — the trap while shortening is going *too thin*: a body so vague a refactor couldn't violate it ("validates input appropriately") is as broken as a mechanics dump. Keep every testable specific; cut only the how.
- **Cut redundancy and narration** — say each thing once, at the altitude a maintainer needs.
- **Stay a living document** — rewrite in place; never add `## vN` history (git carries versions).

Commit per node (`spec: <id> — tidy to contract altitude`) with a `Session:` trailer. Run `spex lint` after each — it must stay at 0 errors.
