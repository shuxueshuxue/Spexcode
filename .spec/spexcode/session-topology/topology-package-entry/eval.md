---
scenarios:
  - name: installed-topology-composes-atomically-across-processes
    tags: [backend-api]
    description: >
      Pack both packages, install only their tarballs in a clean external consumer, run commit and forced-rollback
      relation-plus-enqueue transactions, then let two writer processes compose independently and a third process
      query the resulting database through package-name imports.
    expected: >
      Commit exposes every requested edge and message, forced rollback exposes neither side, two writers produce the
      exact expected edge and message counts, and the independent reader returns the deduplicated stable recipients.
---
# session topology package entry loss

Only installed package-name imports measure this boundary. The transcript records resolved module paths, tarball
hashes, exact edge and message counts, and the independent reader's recipient list.
