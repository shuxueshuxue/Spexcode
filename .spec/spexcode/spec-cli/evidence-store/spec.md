---
title: evidence store
hue: 140
desc: Evidence is content-addressed bytes kept apart from every record that cites them — one store per repository, reached through one CLI noun and one HTTP route, rendered by what the bytes are.
---
# evidence-store

Evidence is the bytes a record points at: a screenshot in an issue body, the frame an annotation is anchored
to, a file pasted into the dashboard. The store keeps bytes and records apart on purpose. Bytes are addressed
by their SHA-256 and by nothing else; a record cites a hash and never carries a copy. Neither half waits on the
other — storing bytes creates no record, and a record may cite a hash whose bytes this checkout does not hold
yet.

A repository has one store, and every surface reaches that same store: the `evidence` noun on the CLI
([[evidence-put]] writes, [[evidence-get]] reads), `/api/evidence` on the backend, the dashboard's upload,
and an `![…](/api/evidence/<hash>)` link in issue prose. How bytes render is decided from the bytes
themselves ([[evidence-kind-taxonomy]]) and never stored beside them, so a classification can change while
every hash and every record stays as it was. A hash the store does not hold is a loud miss on every surface,
never an empty render.
