---
title: source-read
status: active
hue: 195
desc: A governed source file, read over HTTP as a byte WINDOW — the same policy predicate the coverage walk uses decides what may be read at all.
code:
  - spec-cli/src/source-read.ts
related:
  - spec-cli/src/source-files.ts
  - spec-cli/src/index.ts
  - spec-cli/src/lint.ts
---
# source-read

The spec tree has always named the files it governs and never been able to open one. `GET /api/source` is
that missing half: the read side of *spec and code on one screen*.

**A read is a window, not a file.** The caller asks for `path`, `offset`, `limit` and receives
`{path, size, offset, bytes, text, eof}` — the slice plus the file's **total** byte length, so a client
knows the whole extent from the first response and pages by adding `bytes` to `offset`. Whole-file delivery
is not an option that exists here, because it is the shape that has to be walked back the first time a
repository contains one generated bundle: the first paint of a 40 MB file must cost what a 4 KB one costs.
A single slice is capped, and a `limit` above the ceiling is clamped rather than refused — a caller asking
for too much gets the most that is sane, never an error it has to learn to avoid.

**A window ends on a line boundary.** A byte cut mid-line is also a cut mid-codepoint, so the reader would
see a replacement character and half a row that the next window repeats. The slice is snapped back to its
last newline and the **snapped** length is what `bytes` reports, which is what keeps the caller's cursor
arithmetic honest — every window after the first begins at a line start. Two cases decline the snap
deliberately: the final window of a file (there is no following window to hand the remainder to) and a
single line longer than the whole window (snapping would return nothing and the reader would hang forever
on a minified file).

**One gate, not a second definition.** A path is readable exactly when `isSourceFile` says it is — the same
predicate [[spec-lint]]'s coverage walk uses to decide what must be governed, driven by the same compiled
`spexcode.json` source policy. This is deliberate and load-bearing: *what the product will show you* and
*what the product will govern* are then the same set by construction, and cannot drift into two answers that
disagree on a day nobody is looking. It follows without extra rules that the spec tree, `spexcode.json`, test
files, binaries, and anything outside the include globs are all unreadable here.

Escape is refused before any file is touched: an absolute path, a `..` segment, or anything normalising
outside the worktree is a 400, and everything the policy declines is a 404. Both are loud — a refusal never
degrades into an empty body, because a viewer cannot tell "you may not read this" from "this file is blank".

The **window read is shared, the gate is not.** [[node-attachments]] serves a different surface — a spec
node's own folder, which this policy deliberately excludes — and reuses the same slice-and-snap because
"read a byte window and stop on a line" is one behaviour. Two surfaces may disagree about what may be read;
a second copy of the windowing is how they would come to disagree about what `bytes` means.

**Opening a file is half of a surface; the other half is [[source-list]]**, which names what is there to
open one directory at a time. It shares this gate rather than merely resembling it, and that is the sharper
form of the invariant above: what the product LISTS and what it can OPEN are the same set by construction,
so no row can be drawn that clicking would 404.

The route is a thin caller: it resolves the project root, compiles the policy, and hands both to the reader.
It holds no cache. A source file is read from the worktree at request time, so what the board shows is the
working tree as it is now, which is the only reading that can be compared against a spec's claim about it.
