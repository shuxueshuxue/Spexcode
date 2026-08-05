---
concern: test-home-isolation's proof axis is a one-level glob, so a test minting session-record dirs in the real store reads as delta zero
by: 2c787e87-a0ad-4cae-b1db-aa2f1f922f19
status: open
nodes: test-home-isolation
created: 2026-08-05T19:38:34.355Z
---

Spec: test-home-isolation

## The axis measures one level, the class it names lives one level deeper

`temporary-root-never-grows-user-home` counts `~/.spexcode/projects/-tmp-*` before and after the package
test command. Session records do not live there — they live at
`~/.spexcode/projects/<project>/sessions/<id>/`, one level deeper, inside a project directory that already
existed and whose name never matches `-tmp-*`. **A test that mints session-record directories in the REAL
project store moves neither the `-tmp-*` count nor a whole-`projects/` count, so the scenario reads delta
zero while the leak it is named for is happening.**

I am the one who signed the merge proof for this node, using exactly that axis plus an all-project count.
Both counters were blind to this. Recording it rather than leaving the coverage claim wider than the
measurement.

## The population the axis cannot see, measured now

15 directories under the REAL store `~/.spexcode/projects/-home-jeffry-spexcode/sessions/` have no
`session.json` — they are not sessions, they are test residue:

    13 × unit-rvd-{moved,stale,retire}-<pid>-<epoch-ms>/     2026-08-05 11:27:07 .. 12:14:44 (local)
     1 × 019f7974-10a6-7481-b51c-c2d157a8a28a/               2026-07-19 19:08:57
     1 × 1f20b7e3-d249-4a7d-8e29-9ae3eeb2e5bc/               2026-08-04 23:27:14

    contents, union of basenames: 6 × rv.path · 2 × spec-checked · 2 × spec-of-file-seen

The `unit-rvd-*` names carry a pid and an epoch-ms stamp, so they are unit-test constructions, not sessions
whose record was lost. `ls sessions | wc -l` there reads **30**; only **15** are session records.

## This does not contradict the landed fix — and that is checkable, not assumed

Every residue directory has an mtime at or before `2026-08-05 12:14:44` local. The fix landed
(`c12832648`) and the verifying suite ran after `2026-08-06 01:13` local. **Zero residue directories were
created by that run.** So the class is pre-fix, and the record-directory axis, applied retrospectively to
the same run, also reads zero. The defect here is the proof's reach, not the repair.

## Why widening the glob is the wrong repair

Adding `sessions/*` to the pattern fixes this instance and leaves the shape intact: the next writer picks a
path the enumeration does not name, and the scenario reads zero again. The axis fails **silently** when it
is pointed at the wrong subtree, which is the property that made it look like evidence.

A criterion that cannot be blind by construction: stamp the run's start, then enumerate everything under
`~/.spexcode` whose mtime is newer, and require the set to be empty. That names no path, so a new writer
cannot escape it, and an empty result is only reachable by nothing having been written.

Second, note what `delta 0` on this axis does and does not say. The real store currently holds **25800**
`-tmp-*` project directories. The scenario proves the pile did not grow; it does not say the pile is clean,
and a reader who sees `delta 0` will hear the second claim. Whatever the axis becomes should report the
absolute standing count alongside the delta so the two cannot be confused.

## Not done here

The 15 residue directories are the user's home data and are left in place; removing them is not this
issue's business and was not authorized.
