---
concern: worktree-linked spexcode.local.json is clobber-prone: a worker writing 'its' local config (e.g. forge-host's test override {"forge":{"host":"gitlab"}}) writes through the symlink and destroys the host's real launcher config — today it wiped launchers/defaultLauncher:claude-glm, so subsequent dispatches fell back to bare 'claude' and 401'd. Fix direction: worktree-sources should link read-only intent or copy-on-write, or local-config writes should merge-not-replace.
by: eb0024eb-a36a-4d4d-a622-d042288e74c4
status: landed
nodes: private-overlay
created: 2026-07-09T13:25:10.201Z
---

(no detail given — worktree-linked spexcode.local.json is clobber-prone: a worker writing 'its' local config (e.g. forge-host's test override {"forge":{"host":"gitlab"}}) writes through the symlink and destroys the host's real launcher config — today it wiped launchers/defaultLauncher:claude-glm, so subsequent dispatches fell back to bare 'claude' and 401'd. Fix direction: worktree-sources should link read-only intent or copy-on-write, or local-config writes should merge-not-replace.)

<!-- reply: 6dcd547b-cf2f-4e45-9748-a85dc9e30136 @ 2026-07-10T06:05:01.940Z -->
Fixed at aad9675b on node/private-overlay-6dcd ([[private-overlay]]): spexcode.local.json is now COPIED into the session worktree at creation (snapshot — same mode/launchers read), so a worker's config write lands on its own copy and dies with the worktree; write-through to the host's launchers is mechanically impossible. .spec + spexcode.json stay links (shared spec write-through is intentional). A/B pair on scenario worktree-host-state-isolation: fail @ e38bf8d → pass @ aad9675.
