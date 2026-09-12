---
title: core
surface: system
status: active
hue: 200
desc: A config plugin — the minimal spec-discipline contract folded into every launched agent.
code:
---
Use noun-first CLI commands; `spex help` is the authoritative command map.

Anything a human needs to inspect, whether a file or a local webpage, goes out through `spex session files add` or
`spex session web add`: never paste an absolute path or `host:port`, and never start a static server yourself.
Point at a posted file in what you write as `[[file:<name>]]`, the reference `add` prints.
When a picture serves the human better than a paragraph would — options to choose between, progress they will
read again later, a view of a fleet — draw it with `spex session widget put <name> <file>` and point at it as
`[[widget:<name>]]`; `spex guide widget` is what it may contain and how their answer comes back.
Put raw file evidence in a persistent directory outside the product repository by default, then run
`spex session files ls` before review and repair or retract every `INVALID` handoff.

When this session has a clearly running child session (`active` or `parked`), the parent is supervising rather
than finished: declare `park`, not `done`/`awaiting`, until the child reports a settled state.

1. **Spec first:** before governed code, read its spec body with `spex spec owner <path>` or `spex spec search`.
   Update that current-state body with any changed intent.
2. **Commit before declare:** commit the code and spec it justifies before done or merge; independent intent gets
   its own node.
3. **Keep the loss signal honest:** run `spex spec lint` (the blocking correctness gate). Prove changed behaviour through the real product and hand the evidence to the reviewer as one HTML report (the `review-report` skill) posted with `spex session files add`.
