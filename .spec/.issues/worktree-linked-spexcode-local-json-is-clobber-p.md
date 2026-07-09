---
concern: worktree-linked spexcode.local.json is clobber-prone: a worker writing 'its' local config (e.g. forge-host's test override {"forge":{"host":"gitlab"}}) writes through the symlink and destroys the host's real launcher config — today it wiped launchers/defaultLauncher:claude-glm, so subsequent dispatches fell back to bare 'claude' and 401'd. Fix direction: worktree-sources should link read-only intent or copy-on-write, or local-config writes should merge-not-replace.
by: eb0024eb-a36a-4d4d-a622-d042288e74c4
status: open
nodes: private-overlay
created: 2026-07-09T13:25:10.201Z
---

(no detail given — worktree-linked spexcode.local.json is clobber-prone: a worker writing 'its' local config (e.g. forge-host's test override {"forge":{"host":"gitlab"}}) writes through the symlink and destroys the host's real launcher config — today it wiped launchers/defaultLauncher:claude-glm, so subsequent dispatches fell back to bare 'claude' and 401'd. Fix direction: worktree-sources should link read-only intent or copy-on-write, or local-config writes should merge-not-replace.)
