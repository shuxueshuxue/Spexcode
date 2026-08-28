---
title: self-launch storage locality
status: active
hue: 280
desc: Fail-closed filesystem locality classification before the adopter opens its SQLite protocol database — one detector row per platform (Linux statfs magic, Darwin mount flags), every other platform refuses.
code:
  - packages/session-selflaunch/src/locality.ts
related:
  - .spec/spexcode/session-runtime/adopter-cutin/spec.md
  - docs/session-protocol-sqlite-engine.md
---
# self-launch storage locality

The adopter probes the filesystem containing the database parent directory before opening the protocol. A
platform's answer is one detector row, and a platform without a row refuses before probing. **Linux** reads the
statfs magic — the kernel's stable per-filesystem constant — against a small audited allow-list: recognised local
values are admitted; known network values, unknown values including FUSE, and probe failure each refuse with a
distinct `LOCALITY_*` code. **Darwin** cannot use that model: its statfs `f_type` is a vfs registration ordinal
(26 for APFS on one host, anything on another), so the Darwin row reads the mount table the kernel publishes
(`/sbin/mount`), selects the deepest mount point covering the resolved parent, and trusts the kernel's own
`local` flag (MNT_LOCAL) as the verdict; a covering mount without that flag is refused — as `network` when its
type is a known network transport (nfs, smbfs, afpfs, webdav, cifs, ftp), otherwise as `undetermined` — and a
parent no mount covers is undetermined too, never silently local. A missing parent is a loud refusal on every
row: the resolver raises `PROTOCOL_PATH_PARENT_MISSING` itself so it can preserve the CLI's actionable path error
without returning as though locality had been established (the Darwin row stats the parent first, because
`mount` cannot notice an absent directory). Every normal return therefore means that the locality precondition is
positively established or explicitly operator-attested. This judgement never moves into the protocol package.

An operator may bypass detection only with the explicit `--assume-local-storage` flag on that invocation. No
environment variable or config-file field can enable it, because inherited or persistent state would silently turn
an exceptional assertion into a default.

The executable vectors cover local, network, and undetermined classification and every refusal branch on both rows
through injected detectors — a statfs magic for Linux, a transcribed `mount` table for Darwin. They do **not**
establish behaviour on a real network mount: neither host has one, so the Linux network magic values transcribed from
`/usr/include/linux/magic.h` and the Darwin network type names have never been exercised against their corresponding
mounted filesystems. That evidence gap remains OPEN. The Darwin row itself is measured on a real macOS host through
the installed CLI (a session store under `~/.spexcode` on local APFS opens; before the row existed the same host
refused every open with `LOCALITY_DETECTOR_UNAVAILABLE`). Windows has no row and must refuse unless the operator
supplies the explicit per-call flag.
