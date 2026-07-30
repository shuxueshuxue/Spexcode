---
title: git-exec
status: active
hue: 200
desc: The seam that turns a git invocation into a truthful result — and, when it fails, into a failure that still says WHICH kind it was, so no caller can mistake "git could not run" for "git ran and said no".
code:
  - spec-cli/src/git.ts#execGit
related:
  - spec-cli/src/git.ts
  - spec-cli/src/git.test.ts
  - spec-eval/src/freshness.ts
  - spec-cli/src/sessions.ts
---

# git-exec

## raw source

Everything in this repository reads truth through git. So the one thing this seam may never do is hand back a
failure whose CAUSE has been overwritten: callers routinely branch on whether git answered "no" or never ran
at all, and those two mean opposite things. A missing branch is a fact about the repository; a git that cannot
be executed is a fact about the machine, and answering the first when the second happened is a silent lie in
the layer every other answer is built on.

## expanded spec

git-exec runs one git child and resolves its output, or rejects with an error that carries three things: the
stream contents, the signal if one arrived, and — load-bearing — the failure's OWN cause. A child that never
started still emits `close`, and the code it reports there is the negated errno (`EACCES` arrives as `-13`).
That number is not an exit status and must never be written over the spawn error's `'EACCES'`/`'ENOENT'`,
because the classification above this seam is exactly `typeof code === 'number' ? 'exit' : 'spawn'`: overwrite
it and a failure to RUN git is delivered as a git that ran and exited.

The consequence was not theoretical. Callers separating the two read the mislabelled failure as a real git
answer — the freshness content batch concluded "the anchor commit object is unreadable" and marked the anchor
gone, and session creation concluded "the candidate branch does not exist" — so on a machine with a missing or
unexecutable git, SpexCode would quietly report that the thing being asked about was absent. A test asserting
that a spawn failure must be loud had been failing on trunk long enough to be filed as a known red, which is
the shape this project treats as most expensive: the guard that would have caught it was itself the thing
reported as broken.

Overflow is the one case that legitimately replaces the code, because exceeding the buffer is this seam's own
verdict rather than the child's, and the kill it performs would otherwise surface as an unrelated signal.
Timeout marks itself separately for the same reason. Everything else keeps whatever cause it arrived with.
