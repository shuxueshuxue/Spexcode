---
concern: a failed read reports the absence but never the path it consulted or the shape it wanted — three instances, one habit
by: 53f55aa4-83cc-4bb9-95a8-c75666b33d51
status: open
nodes: harness-select, zcode-harness, atomic-landing
created: 2026-08-05T16:38:29.856Z
---

Spec: harness-select, zcode-harness, atomic-landing

Three failures tonight, one theme, recorded as **one** concern rather than three loose bugs.

## The theme

**The system requires or reads something, then reports the failure without saying where it looked
or what shape it wanted.** The message names the absence, which the reader already knows. It
withholds the two facts that would end the search: the path actually consulted, and the shape
actually expected. Every instance below was diagnosed by reading source, never by reading the error
— which is the measurement.

## Instance 1 — `has no harnesses field`, without the path

`spexcode.json` resolution reports `has no harnesses field` when the file is missing. The main
checkout had one; the worktree did not. The message never names **which path it consulted**, so the
reader cannot tell "the file is absent here" from "the file is present but the key is missing" —
two different repairs behind one sentence. Naming the resolved path would have made it a one-line
fix instead of a source read.

## Instance 2 — a silently discarded shape, then a lie about absence

In zcode's `~/.zcode/cli/config.json`, writing `model.main` as an **object** makes
`parseModelTarget` discard it silently; the surface then reports the **config as missing**. Two
faults compounding: the parse drops a value it does not understand without saying so, and the
downstream report converts "present but unparseable" into "absent" — which sends the reader to
create a file that already exists. Neither half states the shape it got or the shape it wanted.

## Instance 3 — a contract that demands a value without naming its source

Workers put the **branch name** in the `Session:` trailer instead of the session id. This was run as
a controlled comparison rather than assumed: a second worker's brief was told explicitly, and
pointed at `spex session show .`. Both outcomes indict us, in different places.

- It got it wrong anyway → **the product does not put the id anywhere prominent enough**; a worker
  in a `node/<slug>` worktree sees the slug constantly and the id nowhere.
- It got it right → **the contract itself never said where the value comes from**, so correctness
  depended on the brief being generous rather than on the contract being complete.

There is no third outcome in which the fault is the worker's. A contract that requires a value must
name its source, and a product that requires an identifier should not hide it behind a verb the
reader has to already know.

## Not fixing tonight

Recorded deliberately without a fix. The point of merging them is that three separate patches to
three message strings would leave the theme intact — the next surface that reads a config or
requires a value will do the same thing. The repair worth designing is a shared habit: **when a read
fails, report the resolved path; when a parse fails, report the shape received and the shape
required; when a contract requires a value, name its source in the contract.**

## Adjacent, same side, different theme

Our `materialize` binds **five** hook events and does **not** bind `PermissionRequest` or
`PostToolUseFailure`. `PostToolUseFailure` is the valuable one: a stuck worker's most common shape
is consecutive tool failures, and we currently cannot receive that signal at all. The defect is on
our side, not zcode's. Filed here as a pointer only, so it is not lost in the merge — it deserves
its own thread when someone picks up hook coverage.
