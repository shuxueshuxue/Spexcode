# Raw Identity Event Stream v15

## Decision

Two immutable streams remain: repository-wide NUL-framed `git log --raw -z --no-abbrev -M -l0` identity
events and merge raw+patch ownership events. One compact identity row stores a status, path pair, old/new
object ids, commit metadata, and any `Spec-OK` trailer. Drift consumes its path projection; `.spec` history
consumes the same OID pair, where equality is a pure rename or mode-only row and inequality is a content
version. The raw mode header is adapter validation only, not stored state.

Numstat is not an event stream or cached index input. A selected history node reads its numeric spec stats
through one `diff-tree --stdin --root -r --numstat -M -l0` batch, filtered by the raw identity projection's
historical `(hash,path)` pairs. Code stats retain their one path-scoped log. This keeps working-tree attribute
interpretation out of permanent ledger/index state without an N-process history page.

The process-local index key is `{eventCacheLocation(root).path, HEAD}`. The ledger path binds the common
repository store and Git interpretation identity, so linked worktrees share a promise while independent
same-HEAD clones cannot. Schema v15 deliberately discards prior uncommitted ledger shapes.

## Evidence

On the 4,863-commit / 1,369-merge root, full-tree numstat took 2.31 s and emitted 1,429,925 bytes; raw
identity took 0.25 s and emitted 1,890,125 bytes. Dirty `.gitattributes` and `info/attributes` changed
numstat while raw output stayed byte-identical. The v15 ledger is 5,952,742 bytes, 621,938 bytes (9.5%) below
v13. Its one cold/hit reading was 5.15 s / 6.71 CPU s / 333652 KiB and 3.64 s / 5.12 CPU s / 323692 KiB;
shared-host variance makes this a cost record, not a speed claim.

An independent-clone control used an identical HEAD, with B first using `.git/info/attributes` and then an
uncommitted `.gitattributes` marking `.spec/**` binary. The raw-OID history retained B's two content versions
in both states. A first A request followed by B produced distinct history/drift promises and two cache slots;
linked worktrees at the same head retained one shared pair. The highest-version real node (`session-console`,
181 rows) took 594 ms through the public `specHistory` API after warming and spawned exactly two Git children:
one code-stat log and one spec-stat `diff-tree --stdin` batch.

The permanent composite covers root, add/modify/delete/type, R100, R<100 despite a too-low configured rename
limit, path reuse, a merge-authored line, byte `0x1e` in a path, content `Spec-OK` self-ack, and an advancing
empty checkpoint reopened in a new process. SHA-256 remains the one separate capability control.

## Product Parity

A real CLI fixture compared `ae06` with the candidate in isolated processes and homes: cold, same-tip hit,
advance, a known anchor failure, `spex spec ack`, and clear lint all had identical exit status, stdout, and
stderr. A fixed 8,200-commit corpus at `89495756` (seed 7,200) and `1341af35` (tip 8,200) likewise had
byte-identical cold, hit, seed, and advancing channels. One paired v15 run measured candidate cold/hit/advance
at 3.41 / 2.70 / 2.85 s versus baseline 3.57 / 3.33 / 3.28 s; these single readings are not a general
wall-time claim.

A real base/edit/rename-edit history also returned byte-identical public `specHistory` JSON for the baseline
and v15. Its selected history read used two Git children: the bounded path log and one `diff-tree --stdin`
batch for display statistics.

## Complexity Audit

The adapter has one typed identity parser and one ledger decoder. They are required to keep NUL framing
structural, persist immutable blob identity, and reject malformed raw records; there is no second drift or
history parser. The projection adds one `contentVersions` relation and path map, replacing
attribute-sensitive persistent numstat facts.

Selected history display statistics use one `diff-tree --stdin` batch instead of one Git child per version.
The cache adds one project-namespaced ledger path component to its existing HEAD key. It does not fingerprint
mutable attributes or construct a shadow repository.

The permanent controls are limited to the persistent reopen/advance state sequence, one real-Git composite
for root/path/rename/merge/RS framing, the independent-clone cache negative with linked-worktree sharing
positive, and one SHA-256 capability guard. Temporary stream comparisons and timing probes remain audit
evidence.

Rejected and deleted shapes: the drift-numstat stream, a separate history-raw stream, persisted mode fields,
parent-tree hydration, persistent numeric stats, per-version history Git children, and intermediate-ledger
compatibility decoding. The implementation delta is `git.ts` +236/-146 (net +90); the focused test delta is
+170/-2 for the required state and real-Git controls.
