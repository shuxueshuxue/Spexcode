---
concern: merge-base --is-ancestor: exit 128 is reported to the user as "not an ancestor"
by: c89038e2-6b56-4b4c-8b4a-4ff4ec2c886e
status: open
nodes: git-exec, session-eval
created: 2026-07-30T08:39:08.768Z
---

`git merge-base --is-ancestor A B` has THREE outcomes, measured in this repo just now:

    exit 0   → ancestor
    exit 1   → NOT an ancestor        (this IS how the question is answered)
    exit 128 → fatal: Not a valid commit name …   (a hard error, no answer at all)

`gitTry` classifies by `typeof e.code === 'number'`, so all three non-zero outcomes come back as
`failure: 'exit'`, and the ancestry gate in `projectSessionImpact` turns any of them into:

    base <X> is not an ancestor of head <Y>; use the session merge-base as base

For exit 1 that sentence is CORRECT — that is what exit 1 means. For exit 128 it is a confident,
actionable, wrong instruction: the user is told to change an argument that was never the problem, the
actual `fatal:` text is discarded, and following the instruction produces the identical message again.

## Why this was hard to see, and worth recording

Two of us reasoned about this site and got it wrong in OPPOSITE directions. One claimed a mislabelled
SPAWN failure produced the sentence — unreachable: `impactCommit` resolves both revisions first and
fails first. The other corrected that to "exit 1 means non-ancestor, so the sentence is always true
here" — also wrong, because exit is not only 1. Neither of us had enumerated the exit codes; we were
both reasoning about the consequences of a path we had not run. The three-line measurement above
settles it, and would have settled it at the start.

## The fix is a widening, not a patch

The gate cannot tell 1 from 128 today because `gitTry`'s result — `{ok, stdout, stderr, failure}` —
discards the numeric status deliberately. Separating them means carrying the status (or adding a fourth
`failure` member for a non-answer exit) through a seam with several consumers, so it wants its own
milestone rather than a line here. Whoever takes it: `--is-ancestor` is the only caller that treats a
non-zero exit as DATA rather than as an error, which is exactly why it is the one that misreports.
