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

<!-- reply: 8bb006f2-ff07-46c9-a216-83c6e32f7777 @ 2026-09-03T13:38:37.669Z -->
Correcting my own framing in the body above: **"on an unhandled verb" is wrong, and it understates this.**
A peer widened the probe to `--help`; following that up located the actual root cause, which is simpler and
broader than a dispatch gap.

`spec-eval/src/cli.ts` is **not an entry point at all.** No shebang, no `bin` entry in `spec-eval/package.json`
— it is exported only as the library subpath `./cli`, and `spec-cli/src/cli.ts:844` is the one real caller:

```
const { runEval } = await import('@spexcode/spec-eval/cli')
await flushExit(await runEval(process.argv.slice(3)))
```

The file has **no top-level invocation**, so running it directly evaluates the module's declarations and exits.
Every input behaves identically, including verbs it does handle:

```
npx tsx spec-eval/src/cli.ts scenario ls --json  -> exit=0  stdout=0  stderr=0   (handled at cli.ts:794)
npx tsx spec-eval/src/cli.ts totally-not-a-verb  -> exit=0  stdout=0  stderr=0
npx tsx spec-eval/src/cli.ts                     -> exit=0  stdout=0  stderr=0
npx tsx spec-eval/src/cli.ts --help              -> exit=0  stdout=0  stderr=0
npx tsx spec-eval/src/cli.ts -h                  -> exit=0  stdout=0  stderr=0
node spec-cli/bin/spex.mjs totally-not-a-verb    -> exit=2  stderr=60   "spex: unknown command … (try: spex help)"
```

So the dispatch chain is fine and the real CLI is correct on bad input. **The defect is that a library module is
named `cli.ts`** — the one name that tells a reader "run me" — with nothing that contradicts that when they do.
`--help` is the sharpest case: the command someone types precisely because they do not yet know the interface
answers "success, and nothing."

Same shape for all four such modules in the repo (`spec-cli`, `spec-eval`, `spec-forge`,
`packages/session-selflaunch`): no shebang, no top-level dispatch. The only executable entry is
`spec-cli/bin/spex.mjs`.

Remedy, replacing the one in the body: either give these modules a non-entry name (`commands.ts`, `verbs.ts`),
or add an `import.meta`-main guard that prints "not an entry — use `spex …`" to stderr and exits nonzero.
Do **not** implement the body's original suggestion (make the unhandled verb exit nonzero inside this file) —
that would add a dispatch fallback to a module whose problem is that it is being executed at all.

Priority stays low: no documented surface asks a user to run these directly. The cost is real but confined to
whoever reaches for the module by name — which has now happened to two of us in one evening, and both times the
answer looked like "there is nothing here" rather than "you are in the wrong place."

<!-- reply: 8bb006f2-ff07-46c9-a216-83c6e32f7777 @ 2026-09-03T13:39:37.248Z -->
One byte-exact addition, because it settles the remedy: the **same function**, entered the way the product
intends, is already correct on bad input.

```
spex eval totally-not-a-verb                      -> exit nonzero  stderr=218   (runEval's own usage)
npx tsx spec-eval/src/cli.ts totally-not-a-verb    -> exit=0        stderr=0
```

Both lines run `runEval`'s dispatch — the first through `spec-cli/src/cli.ts:844`, the second not at all.
So there is no dispatch defect to fix anywhere in this file: 218 bytes of correct usage exist and are reachable.
The entire loss is caused by the module being executed instead of imported. That is one more reason the remedy
belongs at the name / entry guard and **not** inside the dispatch.
