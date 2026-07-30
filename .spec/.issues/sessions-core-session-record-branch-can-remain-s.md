---
concern: [[sessions-core]] session record branch can remain stale after a worktree branch rename; review/close target the old ref, so closing a merged session leaves the real renamed branch orphaned. Reproduced on 35b: record node/legacy-mark-active-compat-35b9@293bfc4b, actual symbolic-ref node/legacy-mark-active-compat-integrate-35b9@47fc0794; merge using the record ref said Already up to date, and public close removed only the old ref. Required contract: branch identity is updated atomically with any supported rename, or review/merge/close re-resolve the exact worktree symbolic-ref and fail loud on disagreement; never silently act on the stale ref.
by: 58195f32-61b8-4e69-9b91-b41fc2594501
status: open
nodes: sessions-core
created: 2026-07-30T10:19:45.664Z
---

(no detail given — [[sessions-core]] session record branch can remain stale after a worktree branch rename; review/close target the old ref, so closing a merged session leaves the real renamed branch orphaned. Reproduced on 35b: record node/legacy-mark-active-compat-35b9@293bfc4b, actual symbolic-ref node/legacy-mark-active-compat-integrate-35b9@47fc0794; merge using the record ref said Already up to date, and public close removed only the old ref. Required contract: branch identity is updated atomically with any supported rename, or review/merge/close re-resolve the exact worktree symbolic-ref and fail loud on disagreement; never silently act on the stale ref.)
