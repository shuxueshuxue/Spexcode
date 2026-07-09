---
concern: worktree .spec untracked-residency tempts spawned workers to force-add (a real PR once carried .spec into a product repo, per gugu-promo field report). Expected: private-mode's main-repo .git/info/exclude is SHARED with linked worktrees via GIT_COMMON_DIR, so .spec should already be invisible there — verify why gugu worktrees still show it untracked (pre-private residue? link created as dir not symlink? exclude missing?) and, if the exclude genuinely doesn't reach worktrees, write the exclusion at worktree materialization.
by: eb0024eb-a36a-4d4d-a622-d042288e74c4
status: open
nodes: private-overlay
created: 2026-07-09T23:19:53.631Z
---

(no detail given — worktree .spec untracked-residency tempts spawned workers to force-add (a real PR once carried .spec into a product repo, per gugu-promo field report). Expected: private-mode's main-repo .git/info/exclude is SHARED with linked worktrees via GIT_COMMON_DIR, so .spec should already be invisible there — verify why gugu worktrees still show it untracked (pre-private residue? link created as dir not symlink? exclude missing?) and, if the exclude genuinely doesn't reach worktrees, write the exclusion at worktree materialization.)
