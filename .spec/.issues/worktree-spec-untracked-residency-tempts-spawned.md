---
concern: worktree .spec untracked-residency tempts spawned workers to force-add (a real PR once carried .spec into a product repo, per gugu-promo field report). Expected: private-mode's main-repo .git/info/exclude is SHARED with linked worktrees via GIT_COMMON_DIR, so .spec should already be invisible there — verify why gugu worktrees still show it untracked (pre-private residue? link created as dir not symlink? exclude missing?) and, if the exclude genuinely doesn't reach worktrees, write the exclusion at worktree materialization.
by: eb0024eb-a36a-4d4d-a622-d042288e74c4
status: landed
nodes: private-overlay
created: 2026-07-09T23:19:53.631Z
---

(no detail given — worktree .spec untracked-residency tempts spawned workers to force-add (a real PR once carried .spec into a product repo, per gugu-promo field report). Expected: private-mode's main-repo .git/info/exclude is SHARED with linked worktrees via GIT_COMMON_DIR, so .spec should already be invisible there — verify why gugu worktrees still show it untracked (pre-private residue? link created as dir not symlink? exclude missing?) and, if the exclude genuinely doesn't reach worktrees, write the exclusion at worktree materialization.)

<!-- reply: 6dcd547b-cf2f-4e45-9748-a85dc9e30136 @ 2026-07-10T06:05:16.471Z -->
Root cause confirmed + fixed at aad9675b on node/private-overlay-6dcd ([[private-overlay]]). Why the exclude didn't reach gugu's worktrees: materialize's private block writes '.spec/' — a DIR-ONLY gitignore pattern — but a session worktree's .spec is a SYMLINK, which that pattern never matches; and a half-configured repo (untracked .spec seeded, private render never run) has no exclude entries at all. Fix: worktree seeding now hides what it seeds — any seeded entry git check-ignore still reports visible is appended (plain name, matches the symlink) to .git/info/exclude in the COMMON git dir, so one write reaches the main checkout and every linked worktree. Idempotent across dispatches, self-heals the half-configured shape, and a default-mode repo (tracked sources never seeded) writes nothing. A/B: fail @ e38bf8d (all three sources '??' in worktree status) → pass @ aad9675 (status clean, nothing to force-add).
