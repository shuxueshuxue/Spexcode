# ZSwarm fail-first evidence

The first read-only command was run against z-code ref `b9b3fa701cad92614285291242930fa59a70cc1f` before the ledger
was written. Its complete stdout/stderr capture is retained byte-for-byte in the external `spexcode-base` study
archive at `studies/session-platform-m5/evidence/zswarm-fail-first.raw.txt`.

```text
sha256  2fb6bf3f76213587ac208d216b546968d8f54817b2494f72fd535eb90ab6899f
lines   763
bytes   92011
```

The capture contains the exact `git status`, object-id, `git ls-tree`, `git show`, and narrow `git grep` commands
used for this inventory. It is immutable evidence; do not rerun into the same file or edit the byte stream.
