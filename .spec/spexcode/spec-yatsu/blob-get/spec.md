---
title: blob-get
status: active
hue: 140
desc: "`spex blob get <hash> [-o <file>]` — blob put's symmetric read: hash in, bytes out; local cache first, backend endpoint on a miss, both gone → fail loud naming each path."
code:
  - spec-yatsu/src/cli.ts
related:
  - spec-cli/src/cli.ts
  - spec-cli/src/help.ts
  - spec-yatsu/src/cache.ts
  - spec-yatsu/src/evaltab.ts
---
# blob-get

[[blob-put]] gave the CLI the write half of evidence transport — bytes in, hash out — but no read: a
user holding a hash (from `yatsu show`, an issue thread's `--evidence`) could only guess at the cache's
internal path or screen-scrape the dashboard. `spex blob get <hash> [-o <file>]` is the symmetric twin:
hash in, bytes out.

Two read paths, both pre-existing — the verb invents no third mechanism:

1. **Local first.** The same content-addressed cache `putBlob` writes (the shared git common dir, read
   via `readBlobByHash` — the exact function the backend's blob route calls). Evidence filed on this
   machine is already on this disk, so the common case needs no backend at all.
2. **Backend fallback.** On a local miss (pruned by `yatsu clean`, or the blob was put on another
   machine sharing the backend), the same `GET /api/yatsu/blob/:hash` the dashboard streams evidence
   from, at the CLI's usual `apiBase()`.
3. **Both missed → fail loud**, naming both paths tried (the local cache path and the backend URL with
   its failure), so the user knows exactly what was searched — never a silent empty output.

Output is stdout by default — pipe-friendly, with the CLI's flush-then-exit drain so a large blob is
never truncated at the pipe buffer; `-o <file>` writes a file instead. Raw bytes aimed straight at a
human's tty get a one-line stderr warning (not a block — the bytes still flow). A malformed hash (not
64 hex) is rejected before any path is tried.
