---
title: evidence-put
status: active
hue: 140
desc: "`spex evidence put <file|->` stores bytes in the shared content-addressed evidence cache and prints the hash without creating a record."
code:
  - spec-cli/src/evidence.ts#blobPut
related:
  - spec-cli/src/cli.ts
  - spec-cli/src/index.ts
  - packages/spec-core/src/evidence.ts
---
# evidence-put

Evidence transport has two independent halves: bytes in the shared cache, and records that cite a hash.
`spex evidence put <file|->` is the byte half. It reads a non-empty file, stores the exact bytes under their
SHA-256 content hash, prints the 64-character hash, and creates no issue or other record. Repeating the
command with identical bytes is idempotent and repairs a checkout whose local cache is missing a referenced
blob.

The cache lives in `.git/spexcode/evidence` under the repository's git common directory, so linked worktrees
share one store. Existing blobs remain at that path and keep the same hash. The hash can be attached to an
issue and rendered by a body link such as `![frame](/api/evidence/<hash>)`; the HTTP route and the
dashboard upload use this same store.
