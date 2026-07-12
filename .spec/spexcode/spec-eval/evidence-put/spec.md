---
title: evidence-put
status: active
hue: 140
desc: "`spex evidence put <file|->` — the bare evidence-transport verb: stash bytes in the shared content-addressed cache and print the hash, decoupled from filing a reading."
code:
  - spec-eval/src/cli.ts
related:
  - spec-cli/src/cli.ts
  - spec-eval/src/cache.ts
---
# evidence-put

Evidence has two halves — the **bytes** (a clip, a screenshot, a transcript, content-addressed in the
shared cache) and the **record** that cites them (an eval reading's `evidence[]`, an issue thread's typed
hashes). Until this verb the only door into the cache was `spex eval add --video/--image`, which welds
the two: you could not cache a clip without also filing a reading. `spex evidence put <file|->` is the bare
transport half — put the bytes ([[eval-core]]'s `putBlob`, the same cache every surface reads via
`/api/evidence`), print the 64-hex content hash, file nothing. The hash is then citable anywhere a bare
hash is accepted: an issue reply's `--evidence`, a `![…](/api/evidence/<hash>)` body link the thread
renders ([[issues-view]]), a later reading. Its symmetric read twin is [[evidence-get]] — hash back to bytes.

Because `putBlob` is idempotent by content, the same command is also the **repair verb** for a checkout
whose cache lacks a blob some thread already references by hash (a fresh clone 404s on inherited
evidence): re-`put` the original file and the hash — being content-derived — lands exactly where the
references point. That idempotence is also why the cache dir rename (`.git/spexcode/yatsu-blobs` →
`.git/spexcode/evidence`, v0.3.0) shipped with **no data migration**: the dir is a per-clone cache, and a
missing blob re-fills by re-putting or streams from the backend on a `get` miss. No flags, no kind
argument — the kind is sniffed from the bytes at serve time ([[video-evidence]]), so the verb stays one
line and the data model grows nothing.
