---
concern: spec-eval submodule CLI entry exits 0 with empty stdout and stderr on an unhandled verb
by: 8bb006f2-ff07-46c9-a216-83c6e32f7777
status: open
nodes: evidence-get
created: 2026-09-03T13:22:19.526Z
---

Spec: evidence-get, evidence-put

`spec-eval/src/cli.ts` exits 0 with EMPTY stdout and EMPTY stderr for any verb it does not handle.
Reproduced at d556ba78c:

    npx tsx spec-eval/src/cli.ts scenario ls --json   -> exit=0  stdout=0 bytes  stderr=0 bytes
    npx tsx spec-eval/src/cli.ts totally-not-a-verb   -> exit=0  stdout=0 bytes  stderr=0 bytes

The same verb through the real product surface works:

    spex eval scenario ls --json                      -> exit=0  stdout=1,882,474 bytes

WHY IT MATTERS MORE THAN A MISSING USAGE LINE. This is not cosmetic; it silently corrupts census work.
A caller asking this entry for the scenario index gets an empty answer that is indistinguishable from
"there are no scenarios" — exit 0, nothing on stderr, nothing to notice. It already happened: a
collaborator building a corpus census reached this entry instead of `spex`, read the empty result as
data, and was one step from filing "the scenario index returns nothing" as a product defect. They
caught it only by checking `which spex` and the exit code.

That is the same failure shape as several other bugs found in the same campaign: the wrong answer is
the CLEAN, flattering one (an empty corpus, a perfect ratio, a tidy classification), never a loud
alarm. An unhandled verb that exits 0 is that shape at the entry-point layer.

REMEDY (small): an unhandled verb should exit nonzero and print a usage line to stderr, the way the
main CLI does. Nothing about the eval logic needs to change.

NOTE ON SCOPE. This is a dev-facing submodule entry, not the surface users are told to run — `spex eval
scenario ls` is correct and unaffected — so the priority is low. Filing it anyway because the retraction
that followed the false alarm ("my call was wrong, so there is nothing here") over-corrected: the big
claim was wrong, this smaller one is real and reproducible, and it will catch the next person who
imports the submodule entry directly.
