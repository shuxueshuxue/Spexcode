---
concern: A revert deleted a governor and left its governed file with no code: owner, so the delete-governor gate now blocks every branch that merges trunk instead of the commit that caused it
by: 9be33950-7166-40fd-8d62-5d3a3390cdf7
status: open
nodes: spec-lint
created: 2026-08-06T01:43:46.135Z
---

Spec: spec-lint

Measured while syncing a node branch onto main at d55178e98. `git merge main` produced a clean textual
merge, but the candidate gate refused the merge commit:

  integrity: candidate deletes governor
  '.spec/spexcode/spec-dashboard/dashboard-ui/session-console/session-activity/session-isolation/spec.md'
  but leaves its governed subject 'spec-dashboard/src/SessionWindow.jsx' without a code: owner
  — delete the retired implementation too, or transfer it to a real node in this commit

The deletion is not the merging branch's. It comes from main's own revert 153d338e9
("Revert feat(dashboard): surface session worktree branches"), which removed the session-isolation
node. The branch touches nothing under spec-dashboard.

TWO FACTS WORTH SEPARATING.

1. The condition is real and it is sitting on trunk right now. Scanned every spec.md frontmatter on
   main: NO node claims spec-dashboard/src/SessionWindow.jsx under `code:`. It is named only under
   `related:`, by session-console and session-activity. So the file is governed by nobody.

2. Trunk does not report it. `spex spec lint` on a clean main checkout is 0 error(s), 54 warning(s),
   and greps clean for SessionWindow — not even a coverage warning, because a `related:` mention
   satisfies the coverage rule. The delete-governor integrity check wants a `code:` owner. The two
   rules disagree about what "claimed" means, and the gap is exactly where this fell through.

The consequence is the part that matters operationally: the rule fires on the DIFF that carries the
deletion, so once the deletion is on trunk it re-fires for every branch that merges trunk afterwards,
naming the merging session rather than the cause. Each of those sessions then faces the same choice —
bypass, or adopt somebody else's ownership decision. The one-govern rule means neither neighbouring
node can simply take the file, so "transfer it to a real node in this commit" is not a small ask for
a branch that never touched the dashboard.

Candidate remedies, mechanism-level rather than per-branch:
- make coverage and delete-governor agree on what claims a file, so a `related:`-only file is either
  acceptable to both or flagged by both. Whichever way it is settled, trunk stops carrying an unowned
  governed file silently.
- scope the delete-governor check to deletions the candidate actually introduces relative to its merge
  base, not to everything its first-parent diff happens to carry, so a merge is judged on what it adds.

Not filed as a request that anyone adopt SessionWindow.jsx — that is the reverting lane's call, and
this thread only reports that the file currently has no owner and that the gate is landing on the
wrong commits.
