---
title: flat
status: active
hue: 165
desc: Flatcode — one local command flattens any repository into a converged .spec tree, terminating on a measured gate rather than on the agent's own claim that it finished.
code:
  - spec-cli/src/flat.ts
related:
  - spec-cli/src/cli.ts
  - spec-cli/src/help.ts
  - spec-cli/src/harness.ts
  - spec-cli/src/lint.ts
  - spec-cli/src/init.ts
  - spec-cli/src/public-graph.ts
  - packages/spec-core/src/layout.ts
  - spec-cli/src/flat.test.ts
---
# flat

**Flatcode**（中文：软件二向箔）turns a repository nobody has ever specced into a `.spec` tree, from one
command, on one machine. `spex flat new <repo-url|path>` clones or adopts the target, infers what counts as
its source, seeds `.spec`, then runs an agent until the spec tree passes a gate. It owns no server, no
account, no queue, and no hostname: the whole capability is a local command whose product is a directory.

The reason this is a command and not a campaign someone supervises is that the expensive part —
an agent reading an unfamiliar codebase and writing intent down — already happens today by hand, and its
stopping condition is a human deciding it looks done. That condition does not survive being left alone.
So the loop here stops on a **measured** signal instead, which is the only reason it can run unattended.

## Convergence is measured, never asserted

A round is one non-interactive agent turn followed by a gate reading. The gate is three existing signals,
and the agent's own report is not among them:

- **[[spec-lint]] errors must be zero.** Integrity, one-govern, id-format, living and mention are structural
  truths about the tree; any of them failing means the tree is wrong, not merely thin.
- **Coverage must reach the requested floor.** Lint already reports each governed source file that no node
  claims. The uncovered count over the governed-file count is the completion metric, and it is the only
  honest measure of "is this repository specced yet".
- **[[doctor]]'s altitude and breadth findings feed the next round's prompt.** They name the nodes that
  dumped mechanics instead of stating intent, and the parents that fanned out too wide. They are the quality
  signal precisely because a tree can satisfy lint completely while reading as a paraphrase of the code.

A round that fails the gate does not retry the same prompt: the findings ARE the next prompt. Rounds are
bounded, and exhausting the budget reports a **partial** flat naming what still fails — never a pass. A
flat that stops early is a legible outcome; a flat that claims success it did not measure is not.

## Profiling is load-bearing, not convenience

A foreign repository has no `spexcode.json`, and lint with no `governedRoots`/`sourceExtensions` finds zero
source files. Zero governed files makes coverage vacuously complete and every drift and coverage rule
silent — the gate would pass an empty `.spec` on any repository in the world. So Flatcode derives the
governed roots and source extensions from what the repository actually contains and writes them down before
the first round, and it refuses to run a gate over an empty governed set. The inferred profile is committed
into the clone so the reading is reproducible and so the user can correct it and re-run.

## The agent seam is one-shot turns

Rounds run through [[harness-adapter]]'s non-interactive turn: a command that reads one prompt, works, and
exits. Flatcode starts no tmux window, registers no session, creates no worktree, and needs no backend —
the target repository never becomes a SpexCode project and never appears on anyone's board. An adapter that
has no non-interactive mode declares none, and Flatcode refuses that launcher by name rather than
substituting one that would silently behave differently.

The spec tree is committed onto a dedicated branch inside Flatcode's own clone, because the graph payload is
anchored to a Git revision and drift is derived from history. That branch is never pushed. Adopting a local
path in place is the same pipeline with the clone step skipped, and it refuses a dirty tree instead of
committing work it did not write.

## What it hands off, and what it is not

A converged flat emits the same static artifact [[public-spec-graph]] already defines — the versioned index,
one document per node, the About metadata, the `.spec` archive, and the release manifest with per-file
SHA-256. It renders from a plain directory with no backend, so a flat is previewable the moment it exists.
Emitting that exact shape is deliberate: the hosted gallery and self-serve conversion that would follow have
a transport specified already, and this command must not force it to be redesigned around a private format.

Flatcode is **not** the hosting. It does not deploy, does not own a subdomain, does not authenticate anyone,
and does not run anything on a server. Those are separate surfaces with their own trust boundaries, and
folding them in here would put an account system inside a command that today only needs a directory to write
into.
