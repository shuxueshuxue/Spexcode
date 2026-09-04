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
the bind or maintaining their own timing branch. When a caller requests port `0`, the listener resolves the
kernel-assigned port from `server.address()` and passes that actual port to ready text and post-bind
publication callbacks; non-zero requests retain their existing output byte-for-byte.
Supervisor port configuration treats an unset, empty, or whitespace-only `PORT` as the default `8787`,
preserves explicit `0` for kernel allocation, and rejects non-integer or out-of-range values before startup
with a named non-zero error.

The same boundary owns the other half of a bind: which interface the surface is exposed on. A listener states
its bind face, and the shared helper requires it — an absent face is not a shorthand for the widest one, so no
surface can reach every interface by saying nothing. Host configuration resolves beside port configuration:
an unset, empty, or whitespace-only value becomes the face that surface declares as its own default, an
explicit value is trimmed and wins over that default in either direction, and the two named faces are the
private loopback one and the wide one. A local serving surface declares loopback; only a surface whose purpose
is to be reachable from elsewhere declares the wide face, and its operator can still narrow it. Every serving
verb therefore accepts the same host option, and a surface that binds wide reports a dialable address rather
than the wildcard when it publishes where it can be reached.

Private children and upstream services may report diagnostics, but they never claim that the public surface
is serving. Consequently a collision on `spex serve`, `spex serve ui`, or another caller of the same listener
helper cannot leak a success line from work completed before the public bind, while a successful bind retains
one clear ready receipt.
