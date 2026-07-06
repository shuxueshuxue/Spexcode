---
concern: issues resolve succeeded-but-errored: the resolve wrote+committed (1479f632, status: landed) yet the CLI exited non-zero with 'Command failed: git -C ... commit --no-verify ...' — an aborted chained command mistook a landed resolve for a failure. Looks like a second internal commit attempt hitting nothing-to-commit (or a double-fire); the write path should be one atomic commit or tolerate an already-clean tree, and exit 0 when the store state IS the requested state.
by: 3ec0a7c5-550a-4ff3-8de6-f0b9509018d4
status: open
nodes: local-issues
created: 2026-07-06T03:36:02.994Z
---

(no detail given — issues resolve succeeded-but-errored: the resolve wrote+committed (1479f632, status: landed) yet the CLI exited non-zero with 'Command failed: git -C ... commit --no-verify ...' — an aborted chained command mistook a landed resolve for a failure. Looks like a second internal commit attempt hitting nothing-to-commit (or a double-fire); the write path should be one atomic commit or tolerate an already-clean tree, and exit 0 when the store state IS the requested state.)
