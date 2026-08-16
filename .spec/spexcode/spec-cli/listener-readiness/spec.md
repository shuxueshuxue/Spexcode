---
title: listener-readiness
hue: 200
desc: One listener boundary owns both port acquisition failure and the publication of user-visible readiness.
code:
  - spec-cli/src/listen.ts
related:
  - spec-cli/src/supervise.ts
  - spec-cli/src/index.ts
  - spec-cli/src/gateway.ts
  - spec-cli/src/gateway-hub.ts
  - spec-cli/src/port-bind.cli.test.ts
---
# listener-readiness

A process may publish a user-visible serving success only after the listener that exposes that surface has
confirmed its bind. The shared listener boundary owns both sides of this transition: before `listening`, a
bind error produces one loud repair and a non-zero exit; after `listening`, it runs any publication side
effect and emits the supplied ready lines. Callers provide ready text as data rather than printing it before
the bind or maintaining their own timing branch.

Private children and upstream services may report diagnostics, but they never claim that the public surface
is serving. Consequently a collision on `spex serve`, `spex serve ui`, or another caller of the same listener
helper cannot leak a success line from work completed before the public bind, while a successful bind retains
one clear ready receipt.
