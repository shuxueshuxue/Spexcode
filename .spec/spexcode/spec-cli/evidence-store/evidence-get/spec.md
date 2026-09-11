---
title: evidence-get
status: active
hue: 140
desc: "`spex evidence get <hash> [-o <file>]` reads content-addressed evidence bytes, using the local cache first and the backend route on a miss."
code:
  - spec-cli/src/evidence.ts#blobGet
related:
  - spec-cli/src/cli.ts
  - spec-cli/src/help.ts
  - spec-cli/src/index.ts
  - packages/spec-core/src/evidence.ts
---
# evidence-get

`spex evidence get <hash> [-o <file>]` is the read half of evidence transport. A valid 64-hex hash is looked
up in the shared `.git/spexcode/evidence` cache first. On a local miss, the command requests the same
`GET /api/evidence/<hash>` route used by the dashboard. If both paths miss, it fails loudly and names the
local path and backend URL that were tried.

Bytes go to stdout by default for piping; `-o <file>` writes them to a file. A malformed hash is rejected
before filesystem or network access. The route serves the stored bytes with a MIME type sniffed from their
content, and existing blobs remain readable without migration.
