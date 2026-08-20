---
title: self-launch storage locality
status: active
hue: 280
desc: Fail-closed Linux filesystem locality classification before the adopter opens its SQLite protocol database.
code:
  - packages/session-selflaunch/src/locality.ts
related:
  - .spec/spexcode/session-runtime/adopter-cutin/spec.md
  - docs/session-protocol-sqlite-engine.md
---
# self-launch storage locality

The adopter probes the filesystem containing the database parent directory before opening the protocol. Linux is
the only detected platform. A small audited allow-list admits recognised local filesystem magic values; known
network values, unknown values including FUSE, unavailable platform detection, and probe failure each refuse with a
distinct `LOCALITY_*` code. This judgement never moves into the protocol package.

An operator may bypass detection only with the explicit `--assume-local-storage` flag on that invocation. No
environment variable or config-file field can enable it, because inherited or persistent state would silently turn
an exceptional assertion into a default.

The executable vectors cover local, network, and undetermined magic classification and refusal branches through an
injected detector. They do **not** establish behaviour on a real network mount: this host has none, so the network
magic values transcribed from `/usr/include/linux/magic.h` have never been exercised against their corresponding
mounted filesystems. macOS and Windows detectors are also absent. Both evidence gaps remain OPEN; those platforms
must refuse unless the operator supplies the explicit per-call flag.
