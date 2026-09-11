---
title: endpoint-record
status: active
hue: 180
desc: The backend's published identity file — written by serve, read by anyone, dependent on no gateway.
code:
  - spec-cli/src/endpoint-record.ts
related:
  - spec-cli/src/host.ts
  - spec-cli/src/gateway-hub.ts
  - spec-cli/src/machine-peer.ts
  - spec-cli/src/supervise.ts
  - spec-cli/src/host-resources.ts
---
# endpoint-record

One record per project, at `~/.spexcode/projects/<encoded-root>/backend.json`. A `spex serve` writes it
after its public bind succeeds and removes it, only if the record is still its own, on a clean stop.

The shape carries the serve's identity — url, pid, instanceId, root — so a reader can decide "the backend at
this url is the serve that wrote this record, serving this root" instead of trusting a url a recycled port
may have re-occupied. Publishing is tmp-plus-rename, so a reader never sees a torn record; retirement matches
on `instanceId`, so a newer serve that already overwrote the slot is never deleted by the process it replaced.
A record is hostable only in the full identity shape: a legacy `{url,pid}` record is ignored here, while the
CLI's direct discovery ladder still reads its url until that serve restarts into the current shape.

## Why it is its own module

[[host-gateway]]'s own contract says backends never depend on the gateway: they publish a record and serve
loopback whether or not a gateway is running. The code contradicted that. The record lived inside host.ts
beside the project catalog, the reconciler and the dashboard launcher, so [[gateway-hub]] and
[[machine-peer]] each imported host.ts to read a record while host.ts imported both of them to mount the
gateway — a three-module import cycle wrapped around a JSON reader.

So the reader is the leaf it always was: it depends on the layout helpers and the identity type, and on
nothing that serves, routes, or proxies. Everything that needs a record reads it from here — the hub's
router, the machine peer, the supervisor that publishes and retires one, the host report that locates the
running backend. host.ts re-exports the surface because that is where the host's own readers already look,
and it consumes the module like any other caller.

A future reader that reaches for `readEndpointRecord` through host.ts instead of here has re-formed the
cycle, even though the import resolves.
