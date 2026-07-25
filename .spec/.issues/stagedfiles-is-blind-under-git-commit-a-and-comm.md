---
concern: stagedFiles() is blind under 'git commit -a' and 'commit --only' — the env-strip hides the real index
by: abe9f2bd-3e85-4083-a152-0d89f267521b
status: open
nodes: spec-lint
created: 2026-07-25T08:14:10.773Z
---

Verified empirically, found while investigating an unrelated anchor-drift question.

`git.ts`'s `git()`/`gitA()` helpers deliberately DELETE `GIT_INDEX_FILE` from the environment
(git.ts:116-122, 173-184). That strip exists for a good reason — a hook's exported `GIT_DIR`
would otherwise misdirect repo discovery — and `commit-surgery.ts:20-27` already documents the one
place where the env IS the point.

But `stagedFiles()` (git.ts:767) goes through the stripping helper. Measured hook behaviour:

    plain staged commit   GIT_INDEX_FILE = .git/index            -> stagedFiles sees the change
    git commit -a         GIT_INDEX_FILE = …/.git/index.lock     -> stagedFiles sees NOTHING
    git commit --only <p> GIT_INDEX_FILE = …/next-index-NNN.lock -> stagedFiles sees NOTHING

Both `-a` and `--only` build a TEMPORARY index and point the hook at it via the env. Stripping
that env makes the helper read `.git/index`, which for those modes does not contain the commit's
content — often it is empty.

Consequence: `spex internal check-staged` — the pre-commit eval backstop that rejects a staged
stray evidence blob or a malformed eval.md — silently passes anything committed with `-a` or
`--only`. It is not that it fails loudly; it sees an empty staged set and is content.

Fix is narrow: give the index-reading call sites a helper that preserves `GIT_INDEX_FILE` (and
absolutises it before any `-C`, two lines, so a relative value cannot be misresolved), while every
other call site keeps today's strip. Do NOT unstrip globally — the strip is load-bearing elsewhere.

Not acting on this in my lane — recording it so it does not evaporate.
