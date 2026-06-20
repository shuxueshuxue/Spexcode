---
title: tidy
status: active
hue: 140
desc: Rewrite a node's body to contract altitude — push mechanics into code comments, keep the contract.
kind: mutating
---
Tidy each target spec node so its body reads as **contract**, not implementation.

{{targets}}

For each target, in its own commit:

- **Preserve the contract** — the intent, invariants, and outward behavior a reader must honor. Never drop
  a requirement; tidying is rephrasing at the right altitude, not deletion of meaning.
- **Push mechanics down** — how the code achieves the contract leaves the body and becomes `@@@title -
  explanation` comments at the code that owns it.
- **Cut redundancy and narration** — say each thing once, at the altitude a maintainer needs.
- **Stay a living document** — rewrite in place; never add `## vN` history (git carries versions).

Commit per node (`spec: <id> — tidy to contract altitude`) with a `Session:` trailer. Run `spex lint`
after each — it must stay at 0 errors.
