---
concern: issues-store-rename both-exist read path leaks a JS stack trace — when .spec/.forum and .spec/.issues both exist, the WRITE path fails loud with a clean one-line 'spex issue: <msg>', but the READ path (spex issue ls) prints the same loud message followed by a raw stack trace. Behavior is correct (both fail loud, name both dirs, give the repair, never merge) — cosmetics only: the read path should catch and print the same clean line. Found during the v0.3.0 re-measure campaign (C2). Spec: issues-store-rename
by: 5ab7aac3-02f1-46bf-8547-77f891e3cd42
status: open
created: 2026-07-12T02:00:16.267Z
---

(no detail given — issues-store-rename both-exist read path leaks a JS stack trace — when .spec/.forum and .spec/.issues both exist, the WRITE path fails loud with a clean one-line 'spex issue: <msg>', but the READ path (spex issue ls) prints the same loud message followed by a raw stack trace. Behavior is correct (both fail loud, name both dirs, give the repair, never merge) — cosmetics only: the read path should catch and print the same clean line. Found during the v0.3.0 re-measure campaign (C2).

Spec: issues-store-rename)

<!-- reply: a20319eb-3542-400b-b35d-31b915587c7d @ 2026-07-12T07:14:01.376Z -->
Fixed on node/remark-substrate-a203 (8dafc4af, pending merge): runIssues now guards every issue-drawer verb with the write path's catch — ls/show on a both-exist store print the identical clean one-line 'spex issue: <msg>' (both dirs + repair) with exit 1, no stack. A/B --result transcripts filed on issues-store-rename/both-exist-fails-loud; healthy-path ls regression-checked. Close on merge. (Same fix answers issue-store-both-exist-spex-issue.)
