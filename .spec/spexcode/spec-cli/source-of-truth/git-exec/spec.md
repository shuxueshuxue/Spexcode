---
title: git-exec
status: active
hue: 200
desc: The seam that turns a git invocation into a truthful result — and, when it fails, into a failure that still says WHICH kind it was, so no caller can mistake "git could not run" for "git ran and said no".
code:
  - packages/spec-core/src/git.ts#execGit
  - packages/spec-core/src/git.ts#gitBinary
  - packages/spec-core/src/git.ts#git
  - packages/spec-core/src/git.ts#gitBuffer
  - packages/spec-core/src/git.ts#requireGitWorkspace
  - packages/spec-core/src/git.ts#warnIfTimedOut
  - packages/spec-core/src/git.ts#gitInterpretationIdentity
  - packages/spec-core/src/git.ts#sourceIndexes
  - packages/spec-core/src/git.ts#sourceIndexesFull
  - packages/spec-core/src/git.ts#worktreeSpecDeltas
  - packages/spec-core/src/git.ts#batchRevisionOids
related:
  - packages/spec-core/src/git.ts
  - spec-cli/src/git.test.ts
  - spec-cli/src/workspace-precondition.cli.test.ts
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

The executable is resolved from the child environment's `PATH` before the first spawn and reused only while
that exact `PATH` still names an executable at the cached location. All sync and async paths consume this one
resolved path, so one materialize with many small Git queries does not repeat the shell's whole PATH search for
every child. The cache key is the PATH itself, not process-global identity: a caller that supplies a Git wrapper
through a different child environment receives that wrapper, and removing a cached executable makes the next
call resolve the current PATH again. Resolution failure remains a spawn-class machine failure, never a Git
negative answer.

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
A child fed on stdin can reject its input before the pipe drains; on both the buffered and the streaming
entrance that write failure travels the child's own close path and keeps its own cause, so it is neither an
unhandled EPIPE nor an exit status the child never returned.

Many worktrees asking the same immutable tree question are one Git transport demand, not one child per
worktree. The batch first freezes each worktree HEAD and its merge-base against the one resolved
main tip, separates working trees with a real `.spec` overlay, and sends the clean tree pairs through one
`diff-tree --stdin` stream. The demand is pinned to the existing shared Git interpretation identity (object
format, shallow and graft bytes, and replacement refs) and is revalidated after the child completes; a changed
interpretation is an unpublishable read, never a result cached under unchanged raw SHAs. `--always` frames even
an empty pair, so one no-op cannot shift every later answer;
the parser consumes those frames in request order and fails loud on a missing or extra frame. Dirty and
untracked worktrees keep the ordinary worktree-aware path. The batch pins rename detection and
`core.quotePath=false`: name-status parsing receives literal repository paths rather than a user's Git quoting
preference, and a rename has the same meaning in the batch and fallback paths.

The synchronous text and buffer entrances share one explicit output budget large enough for repository-wide
Git projections. They never inherit Node's smaller default: a valid `ls-tree` or history answer crossing that
default is still Git truth, not a failed command. Crossing SpexCode's explicit budget remains a loud overflow,
while only the timeout marker may be described as a timeout; the SIGKILL used to enforce either boundary is
an implementation detail and cannot collapse the two diagnoses.

An unborn `HEAD` is Git's valid empty-history state, not an absent object to query. `headSha()` names it with
an internal sentinel solely for the root-owned cache identity; the source-index builders interpret that sentinel
as empty history before any history command is assembled. Both history and drift projections therefore have no
versions, topology, events, or tip until the first commit exists, while the working-tree graph can still observe
the first uncommitted `.spec` tree normally. A genuinely unreadable `HEAD`, an explicit invalid revision, or a
Git child failure remains loud: this is one legal Git state, never a caller-side catch or a broad error fallback.

Repository discovery is an earlier product boundary than this transport seam. A directory before `git init`
must be refused once as a Git-workspace precondition: name its absolute path and direct the reader to run
`git init` there before retrying. History entrances and graph assembly consume that common refusal before they
ask this seam to derive anything, so they cannot expose an internal history purpose or raw child stderr for the
same missing repository. `gitRequiredA` remains the common safety net after that boundary; it preserves a real
child failure rather than guessing that every failed Git invocation means the directory needs initialization.

## who reads this classification

Seven call sites branch on it, across two packages and in BOTH polarities, so the cause this seam preserves
is not a local concern:

    spec-cli/src/sessions.ts   1718 · 2660 · 2692 · 2693 · 2792   `failure !== 'exit'`
    spec-eval/src/freshness.ts 183                                `failure !== 'exit'`
    spec-eval/src/sessioneval.ts 410                              `failure === 'exit'`

The reversed-polarity one is where this classification is easiest to misread, including by me. Both of its
branches raise the same error type and differ only in the sentence, and the `exit` sentence is *"base X is not
an ancestor of head Y; use the session merge-base as base"* — an instruction the reader will act on. An earlier
version of this body claimed a mislabelled spawn failure produced it. That was wrong twice over, and measuring
is what showed it: an unexecutable git never reaches the gate at all, because `impactCommit` resolves both
revisions first and fails first; and `merge-base --is-ancestor` answers "not an ancestor" precisely BY exiting
1, so on the exit path that sentence is a correct diagnosis rather than a false one.

What measurement did surface there is a different defect, still unfixed: `--is-ancestor` exits 0 for ancestor,
1 for not-an-ancestor, and **128 for a hard error** (`fatal: Not a valid commit name`). All three non-zero
outcomes classify as `exit`, so a 128 is reported to the reader as "your base is not an ancestor; use the
session merge-base" — a confident, actionable, wrong instruction. Telling 1 from 128 needs the numeric status
this seam currently discards, which is a widening of its result shape rather than a one-line change, so it is
filed rather than patched here.

The session-impact fixture now pins both observable resolution outcomes: an unexecutable Git reports a spawn
failure before ancestry is considered, while a real non-ancestor retains the actionable merge-base diagnosis.
The hard-exit-128 distinction remains the unfixed boundary above. Five of the seven sites are reached only on
a machine where Git is missing, unexecutable, or timing out, so ordinary runs still cannot stand in for this
failure proof.
