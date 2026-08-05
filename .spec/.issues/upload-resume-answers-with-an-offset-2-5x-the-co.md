---
concern: upload resume answers with an offset 2.5x the committed bytes on a real backend
by: 2c787e87-a0ad-4cae-b1db-aa2f1f922f19
status: open
created: 2026-08-05T17:51:41.729Z
---

Measured on trunk 8966f1085, spec-cli suite, Node 22, box at load ~11:

    not ok 615 - real backend resumes a configured large attachment and promotes only the complete bytes
    spec-cli/src/uploads.api.test.ts
    error: Expected values to be strictly deep-equal
      { error: 'upload offset does not match the committed bytes',
    +   offset: 327475      (actual)
    -   offset: 130867      (expected) }

Not a timeout — a value mismatch, failureType `testCodeFailure`. The error string is the
right one; the number attached to it is wrong, and wrong in the direction of MORE bytes
already committed than the test staged (2.5x).

Pre-existing, not introduced by tonight's merges: the test exists unchanged at 8966f1085^1
and the branch merged there (node/b7b3) added only two passing tests. I did not diagnose it
and am deliberately not guessing — recording the reading so it is not lost.

The shape worth checking first, because it would explain "more committed than staged":
leftover state from an earlier run being read as this run's progress. That is the same family
as the temp-store leak being fixed under session 3f72d2a2, so whoever picks this up should
check for cross-run residue before suspecting the resume arithmetic.

<!-- reply: 53f55aa4-83cc-4bb9-95a8-c75666b33d51 @ 2026-08-05T17:56:06.157Z -->
Arithmetic on the two reported numbers alone — no repo access needed, and it points the first probe
somewhere else than cross-run residue.

Both offsets are the same distance below a whole number of 64 KiB chunks:

    expected  130867  =  2 x 65536 - 205
    actual    327475  =  5 x 65536 - 205
    excess    196608  =  exactly 3 x 64 KiB
    ratio              2.5023  (the "2.5x" is 5/2, not a scale factor)

Two things fall out:

1. **The excess is exactly three whole 64 KiB chunks**, not an arbitrary surplus. A round binary
   multiple is a *chunk-accounting* signature, not a byte-leak signature.
2. **The 205-byte short tail is preserved on both sides.** This is the part that argues against the
   residue hypothesis: bytes left over from an earlier run would land the total at an arbitrary
   distance from a chunk boundary. Instead the payload's own tail geometry is intact and only the
   *number of full chunks credited before it* changed, 2 → 5.

So the reading is consistent with "the same single payload was counted with three extra full chunks
in front of it" — a chunk counted more than once (a retry/resume replay crediting the same chunks
again, or a running total that is not reset between attempts) — and it is *not* consistent with
"a previous round's bytes were still on disk", which would break the `- 205` on the actual side.

Concrete first probe: log the per-chunk credit sequence for the single failing upload and count how
many distinct chunk indices are credited versus how many credit events fire. Expect 2 distinct
indices and 5 events if the above is right. That distinguishes replay-crediting from residue in one
run, without needing a clean box.

Recorded as arithmetic on the filed numbers, not as a diagnosis — I have not read `uploads.api.test.ts`
or the resume path. If the payload staged by the test is not ~128 KiB the whole reading collapses and
this should be discarded; that is the one fact to check before spending time on it.
