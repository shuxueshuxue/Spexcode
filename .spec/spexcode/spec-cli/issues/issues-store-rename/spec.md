---
title: issues-store-rename
status: active
hue: 45
desc: M4 of the eval/issue/remark refactor — finish the forum kill at the bottom data layer. The local issue store's on-disk directory becomes .spec/.issues (was .spec/.forum), with a one-shot self-migration so every existing deployment renames itself on first touch and no thread is lost.
---
# issues-store-rename

## raw source

M3 ([[eval-issue-split]]) killed the word "forum" from every code identifier, but deliberately left the
**data directory** named `.spec/.forum` — a rename touches every deployment's on-disk store, so it was
parked as residue. The directive was to refactor the substrate all the way down, and the directory name is
the bottom-most name there is. So it goes too: the store now lives at `.spec/.issues`, and the local store is
named, top to bottom, as what it holds — a **local Issue**.

The one thing a data-dir rename must not do is break a running deployment or lose a thread. The store is
plain git-tracked files under a fixed path ([[proposals]]); an old toolchain reads `.spec/.forum`, a new one
reads `.spec/.issues`, and the gap between "toolchain updated" and "directory moved" is exactly where a
deployment would silently read an empty store. So the rename cannot be a manual step someone remembers to
run on each box — it has to ride the store's own first touch.

## expanded spec

**One mechanism, no per-deployment branch.** [[proposals]] owns the store's whole seam, so the migration
lives there too and every deployment migrates itself the same way — there is no host-specific if/else and no
operator checklist. The trigger is the store's **first touch** after the toolchain updates: any read (the
board, `spex issues`) or any write (a propose/reply/remark) reaches the store through [[proposals]], and
that is where the legacy directory is noticed and moved, before the touch proceeds. A fresh repo that never
had `.spec/.forum` skips it entirely; a deployment that already migrated skips it on the fast path with no
work.

**The move is one committed rename on the trunk, so history survives.** Because the store *is* git (a
thread's version and reply history are read from the commit log), the migration is a single `git mv` of the
directory committed straight to the main checkout — not a copy-and-delete. A `--follow` read of any thread
after the move traces cleanly back through the rename into its whole pre-rename history: the reply timeline
reads identically. The commit is data, not a spec version (a pure rename bumps no node), and lands
`--no-verify` like every other store write, so it needs no [[main-guard]] exception.

**Atomic against a first-touch burst, loud on the pathological case.** SpexCode runs parallel workers, so
the first store touch after an update can arrive from several at once. The find-check-move runs under the
same store lock every write already holds ([[proposals]]), so a burst produces **exactly one** rename
commit: the racer that waited re-checks under the lock and finds the move already done. The one state the
store must never resolve by guessing is **both** directories present — a genuine `.spec/.forum` *and* a
genuine `.spec/.issues` — since auto-merging could drop threads; that fails **loud** with the manual repair,
never a silent union.

This retires [[eval-issue-split]]'s "deliberate residue": the forum kill is now complete at every layer, and
the migration mechanism — not the old name — is the standing contract.
