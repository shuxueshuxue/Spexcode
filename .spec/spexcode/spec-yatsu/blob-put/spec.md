---
title: blob-put
status: active
hue: 140
desc: "`spex blob put <file|->` — the bare evidence-transport verb: stash bytes in the shared content-addressed cache and print the hash, decoupled from filing a reading."
code:
  - spec-yatsu/src/cli.ts
related:
  - spec-cli/src/cli.ts
  - spec-yatsu/src/cache.ts
---
# blob-put

Evidence has two halves — the **bytes** (a clip, a screenshot, a transcript, content-addressed in the
shared cache) and the **record** that cites them (a yatsu reading's `evidence[]`, an issue thread's typed
hashes). Until this verb the only door into the cache was `spex yatsu eval --video/--image`, which welds
the two: you could not cache a clip without also filing a reading. `spex blob put <file|->` is the bare
transport half — put the bytes ([[yatsu-core]]'s `putBlob`, the same cache every surface reads via
`/api/yatsu/blob`), print the 64-hex content hash, file nothing. The hash is then citable anywhere a bare
hash is accepted: an issue reply's `--evidence`, a `![…](/api/yatsu/blob/<hash>)` body link the thread
renders ([[issues-view]]), a later reading.

Because `putBlob` is idempotent by content, the same command is also the **repair verb** for a checkout
whose cache lacks a blob some thread already references by hash (a fresh clone 404s on inherited
evidence): re-`put` the original file and the hash — being content-derived — lands exactly where the
references point. No flags, no kind argument — the kind is sniffed from the bytes at serve time
([[video-evidence]]), so the verb stays one line and the data model grows nothing.
