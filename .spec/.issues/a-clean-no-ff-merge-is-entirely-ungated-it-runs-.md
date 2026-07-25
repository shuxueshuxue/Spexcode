---
concern: a clean --no-ff merge is entirely ungated — it runs pre-merge-commit, which SpexCode does not ship
by: abe9f2bd-3e85-4083-a152-0d89f267521b
status: open
nodes: spec-lint, ci-gate
created: 2026-07-25T08:13:54.054Z
---

Verified empirically (git 2.43.0, throwaway repos), found while investigating an unrelated
anchor-drift question.

A clean `git merge --no-ff` runs the **`pre-merge-commit`** hook, NOT `pre-commit`. SpexCode's
shipped hook family is post-checkout, post-merge, pre-commit, prepare-commit-msg — there is no
`pre-merge-commit`. So the dogfood ritual's normal merge onto the trunk passes through **no gate
at all**: no spec lint, no main-guard, no eval backstop.

Only a CONFLICTED merge, finished by a manual `git commit`, reaches `pre-commit`. That is why the
gate appears to work — the merges people notice are the ones that conflicted.

Why it matters beyond tidiness: the merge is the moment work reaches the trunk, and in this
project it is a deliberate human/dispatched act, so it is arguably the single most valuable place
to check anything. Today it is the one door that is entirely unlatched, which also means every
"the hook enforces X" statement in the docs is false for the merge path specifically.

Remedy is small: ship `pre-merge-commit` as a shim over the same check pre-commit runs. It joins
the templates dir, so init's receipt, materialize, and CI's byte-parity check move with it.

Not acting on this in my lane — recording it so it does not evaporate.

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-25T08:43:11.485Z -->
CORRECTION — the title and the original body overstate this. Measured (git 2.43.0, probe repo):

A clean `git merge --no-ff` runs:

    pre-merge-commit    yes  (SpexCode ships none -> nothing happens)
    pre-commit          NO
    commit-msg          YES  — with MERGE_HEAD present and the staged tree readable

So a clean merge is NOT "entirely ungated". It skips `pre-commit` — which is where spec-lint,
main-guard, and the eval backstop live today — but `commit-msg` does fire. Today SpexCode's
`commit-msg`... it ships none either, so in PRACTICE nothing gates a clean merge. The defect is
real; my description of the mechanism was wrong.

This matters beyond bookkeeping: it means the gate a clean merge is missing can be restored EITHER
by adding `pre-merge-commit` (as I originally suggested) OR by putting the check in `commit-msg`,
which fires for both ordinary commits and clean merges through one path instead of two.

Also verified while checking this: `commit-msg` receives `GIT_INDEX_FILE` pointing at the temp
index under `git commit -a` (`.git/index.lock`) and `--only` (`.git/next-index-NNN.lock`), and
`git diff --cached` under it reports the correct file set (`--only b.txt` reported only b.txt).
So a commit-msg-hosted check sees the true pending content in every commit mode — provided it does
not strip GIT_INDEX_FILE, which is the sibling issue.
