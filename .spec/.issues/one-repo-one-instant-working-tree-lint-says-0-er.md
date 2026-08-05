---
concern: one repo, one instant: working-tree lint says 0 errors and the commit gate says 1733 — neither says which tree it judged, and the remedy offered is a bypass
by: 53f55aa4-83cc-4bb9-95a8-c75666b33d51
status: open
nodes: spec-lint, spec-cli
created: 2026-08-05T17:16:22.716Z
---

Spec: spec-lint, spec-cli

**Same repository, same instant, two verdicts:**

```
working-tree lint : spex spec lint: 0 error(s), 19 warning(s)
commit-gate       :               1733 error(s), 19 warning(s)
```

Measured by @2c787e87 on `/home/jeffry/zcode-mirror`. The **warnings are identical on both sides** —
19, matching item by item including confusable-id, coverage and drift — so the graph loaded correctly
both times. **Only integrity (file existence) diverges.**

The cause is counted, not guessed:

```
tracked files in mirror   : 1310
  of which .spec          : 1268
  of which source         :   23
.ts/.tsx in working tree  : 8947   <- UNTRACKED
```

The mirror **tracks only specs; z-code's source is not in version control at all.** So working-tree
lint checks paths where the files exist → 0, and the commit gate checks the tree that would actually be
committed, where they do not → 1733.

## The gate is not miscomputing — the diagnosis is missing

In the candidate tree those 1,733 files genuinely are absent, so the number is correct. Three things
are wrong around it:

1. one repository yields 0 and 1733;
2. **neither side says which tree it judged**, so the two numbers look like a contradiction rather than
   two answers to two different questions;
3. the remedy offered is a **bypass** (`SPEXCODE_SKIP_LINT=1`) plus 1,733 lines of "missing file", when
   the true diagnosis is a single sentence: **your code is not tracked.**

A narrow, honest fix exists and does not touch the contract: when a candidate-tree integrity miss names
a path that **exists in the working tree but is untracked**, say *that*, once, instead of N per-file
"missing file" lines — and do not lead with the bypass. Same exit code, same gate, one true sentence
instead of a wall.

## What this means for the "governed z-code workspace" claim — say it plainly

The 476 spec nodes on that mirror **govern code that is not under version control**, and a dispatched
worker's worktree receives 1,310 files instead of 8,947. This inverts the adoption-blocker list's first
item: that item is "`.spec` is untracked"; here `.spec` **is** tracked and the *code* is not, which is
worse — the spec side of the graph is versioned and the side it makes claims about is not.

The practical consequence, stated without softening: **every commit in that mirror is bypassing the
gate.** `f3fc224` and `984fe3b` went in that way, and so did the config commit `9c24692` — the only
difference being that the last one recorded its reason in the commit body rather than bypassing
silently. Any claim of the form "z-code is a governed workspace" has to be read against that.

Raw adoption-blocker measurements: `spexcode-base` `studies/zcode-adoption-blockers/notes.md`.

<!-- reply: 53f55aa4-83cc-4bb9-95a8-c75666b33d51 @ 2026-08-05T17:56:46.432Z -->
The remedy this issue leaves implicit — "then track the governed source" — has now been measured on the
same mirror by session `2c787e87`, and it is **not a small step**. Recording it here because it changes
this issue's option set, not just its context.

What `git add -A` would stage on that mirror:

    paths staged                     : 18173
      AppleDouble / .DS_Store        :  8069   (44%)
      source                         :  7997
    >1MB blobs                       : 4.2MB .webm, 2.4MB png, 2.1MB api.json, 1.6MB .icns
    .gitignore itself                : NOT tracked
    .env.development / .env.production / .env.e2e.local.example
      + apps/zcode-cli/.env.template : four files, none masked by gitignore;
                                       three contain long value assignments

(Path/mask/count measurements only — no values were read or written anywhere.)

So on a real monorepo the cheap-sounding remedy commits 8069 junk files, several MB-scale binaries, and
**four unignored `.env` files** into history. The absence of a remote does not reduce that: credentials in
commit history are in commit history.

Two consequences for this issue:

1. **The diagnostic fix stays narrow and stays worth doing.** Nothing above touches it — saying
   "N governed paths exist in the working tree but are untracked" once, with a count, is still one
   sentence and still the honest verdict. It gets *more* valuable, not less, because it is now the only
   cheap half.
2. **"Track them and the gate starts working" must stop being stated as the obvious follow-up.** The
   ordered form is: track `.gitignore` first → add by source extension, targeted → mask AppleDouble →
   exclude `.env*` explicitly and confirm each one separately. That is a reviewed add, not a side effect
   of another task, and it should not be smuggled in as cleanup while doing something else.

The gate arithmetic in the issue body is unaffected — those files genuinely are absent from the committed
tree, and every commit in that mirror genuinely is bypassing the gate. What changes is that closing the
bypass is its own reviewed piece of work with a credential-exposure step in the middle of it.
