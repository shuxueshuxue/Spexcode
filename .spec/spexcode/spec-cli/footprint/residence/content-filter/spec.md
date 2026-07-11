---
title: content-filter
status: active
hue: 200
desc: The mixed-content answer — a per-clone git clean/smudge filter for a contract file the host TRACKS (or has begun writing its own prose into) keeps the pristine host prose in the index and the injected block in the working tree; clean(smudge(x)) == x.
code:
  - spec-cli/src/contract-filter.ts
---
# content-filter

## raw source

A mixed-content file is the one place exclude cannot reach: the filter chain lives on git's TRACKED
pipeline (checkout smudges, stage/diff cleans), the ignore family on the untracked namespace, and a
contract file that carries BOTH host prose and our block needs the tracked-pipeline tool — gitignoring a
tracked file is a no-op, and the folded-in block would otherwise ride the file into every teammate's diff.
The filter keeps the two contents on their own sides of the index: the repo stores the HOST's pristine
prose (clean strips our sentinel block on stage/diff), the WORKING TREE carries prose + block (smudge
re-injects on checkout), and history never sees the block.

## expanded spec

The sentinel markers (`<!-- spexcode:start/end -->`) are the load-bearing anchor: clean strips exactly the
marked block, smudge (re)injects it, and the invariant is **clean(smudge(x)) == x** — for text ending in
one newline, git's own well-formed shape; a 0-or-2+-newline tail normalizes once on the first round-trip,
then stays stable. Smudge strips defensively before injecting, so a block that somehow reached the index
can never double-inject.

Everything the filter needs is PER-CLONE — zero repo footprint: `git config filter.spexcode.smudge/clean`,
a managed block in `.git/info/attributes` binding each covered file, and a shim + block-content pair under
`<git-common>/spexcode/` (a dir shared with other per-clone spexcode data — only our two files are ever
ours to remove). The block-content file is what smudge injects, so the materialize and future checkouts always
agree.

**Where it is planted — mixed content, present or imminent.** The kind detection ([[residence]]) binds
the filter for a contract file that is host-TRACKED, and PRE-ARMS it for an untracked contract file the
user's own prose has entered: arming costs nothing while the file stays untracked (no pipeline events
fire), and it makes the user's eventual `git add` — through any route, `-p` included; the block never even
appears in a hunk, since add/diff compare clean(worktree) against the index — strip the block
automatically. A wholly-ours contract file gets no filter: exclude is the weakest sufficient tool there.

Three field-verified edges the mechanism must hold:

1. **Graceful degradation.** The configured filter command points at the STABLE shim path and tests it
   before exec, degrading to `cat` (identity) when the shim is missing — a bare missing filter command
   makes git spray fatals on EVERY operation touching the file.
2. **No self-propagation + the phantom-`M`.** git re-smudges only on checkout, so a changed contract does
   not propagate by itself: the re-materialize writes the managed block straight into the working file (the
   block write IS the re-smudge) and refreshes the shim's block-content file. And a filtered path can never
   be verified by stat alone, so `git status` reports it modified FOREVER without content-checking (while
   `git diff` runs the filter and shows nothing) — settled by a content-GUARDED `git add --renormalize`:
   run only when the cleaned worktree already equals the index blob, a pure stat refresh that can never
   stage a user's real unstaged edit (a genuine edit keeps its honest `M`).
3. **Ordered unplant.** Strip the block from the working files FIRST, then remove attributes/config/shim —
   the reverse order leaves the block exposed as an uncommitted modification the moment the clean filter
   disappears ([[harness-delivery]]'s erase order honors this).

The filter guards the ADD path; the index a commit is actually built from is re-checked once more at the
last gate by [[commit-surgery]] (a blob staged before the filter existed — a `-f`, a pre-arming edit —
is cleaned there in place). Between the two, no route into history carries the block.

**JSON mixed content is NOT implemented** — the designed successor, recorded here so nobody re-derives it:
a host-tracked `settings.json` is answered by REDUCING THE DIMENSION, not by merging — claude's
`settings.local.json` turns the mixed-content problem into a whole-file machine fact — with an identity
stamp on any entry we'd ever have to co-own inside a shared JSON. No smudge/clean for JSON until a real
host forces it.
