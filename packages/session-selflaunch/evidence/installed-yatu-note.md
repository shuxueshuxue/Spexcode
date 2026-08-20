# Installed YATU note

The transcript in `installed-yatu.log` was produced after implementation commit `0b3a4cfd8` with Node 22.21.0 and
SQLite 3.50.4. It packed `@spexcode/session-protocol@0.6.7` and `@spexcode/session-selflaunch@0.6.7`, installed only
those tarballs into a new `/tmp` consumer outside the repository, and resolved both packages and the bin under that
consumer's `node_modules`.

Every CLI step was a completed child process before the next began. The transcript records four path sources, loud
relative/missing-parent failures, initialize, enqueue A/B, ordered pending, dequeue A/B/null, exact idempotent replay,
changed-byte conflict, and a restart message that remained durable with zero resident processes and zero wake hints.

The real locality probe covered this host's local filesystem. The supplied-magic vectors covered classifier branches
for local, network, and undetermined types, but this host has no network mount: the network magic values copied from
`/usr/include/linux/magic.h` were not executed against real NFS/SMB/etc. macOS and Windows detectors are also absent.
Real network-mount validation and non-Linux detectors remain OPEN and are not claimed by this pass.
