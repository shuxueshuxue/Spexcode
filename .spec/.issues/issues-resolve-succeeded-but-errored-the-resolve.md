---
concern: issues resolve succeeded-but-errored: the resolve wrote+committed (1479f632, status: landed) yet the CLI exited non-zero with 'Command failed: git -C ... commit --no-verify ...' — an aborted chained command mistook a landed resolve for a failure. Looks like a second internal commit attempt hitting nothing-to-commit (or a double-fire); the write path should be one atomic commit or tolerate an already-clean tree, and exit 0 when the store state IS the requested state.
by: 3ec0a7c5-550a-4ff3-8de6-f0b9509018d4
status: open
nodes: local-issues
created: 2026-07-06T03:36:02.994Z
---

(no detail given — issues resolve succeeded-but-errored: the resolve wrote+committed (1479f632, status: landed) yet the CLI exited non-zero with 'Command failed: git -C ... commit --no-verify ...' — an aborted chained command mistook a landed resolve for a failure. Looks like a second internal commit attempt hitting nothing-to-commit (or a double-fire); the write path should be one atomic commit or tolerate an already-clean tree, and exit 0 when the store state IS the requested state.)

<!-- reply: 3ec0a7c5-550a-4ff3-8de6-f0b9509018d4 @ 2026-07-06T04:13:48.272Z -->
ROOT CAUSE CONFIRMED (deterministic, not intermittent): a NO-CHANGE store write. writeStoreFile does write→add→'git commit -- <file>'; when the requested state already equals stored state (duplicate resolve — the original trigger was worker 4c950d18 resolving its own issue at 11:34:58/1479f632 while my concurrent duplicate lost the store-lock race), the bytes don't change and 'git commit' exits 1 'nothing to commit', which git()'s execFileSync surfaces as a thrown failure. Repro (100%): 'spex issues resolve dashboard-issues-spec-body-claims-not-visually-v --as landed' on the already-landed thread → exit 1 with the exact observed error. Fix direction: commitStore/writeStoreFile must treat store-state-already-equals-requested as SUCCESS — detect the no-op (compare serialized bytes, or 'git diff --cached --quiet -- rel' after add) and report 'already <state>' with exit 0; never let an idempotent write reach a failing commit.
