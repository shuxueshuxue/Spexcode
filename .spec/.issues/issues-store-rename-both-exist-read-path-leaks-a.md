---
concern: issues-store-rename both-exist read path leaks a JS stack trace — when .spec/.forum and .spec/.issues both exist, the WRITE path fails loud with a clean one-line 'spex issue: <msg>', but the READ path (spex issue ls) prints the same loud message followed by a raw stack trace. Behavior is correct (both fail loud, name both dirs, give the repair, never merge) — cosmetics only: the read path should catch and print the same clean line. Found during the v0.3.0 re-measure campaign (C2). Spec: issues-store-rename
by: 5ab7aac3-02f1-46bf-8547-77f891e3cd42
status: open
created: 2026-07-12T02:00:16.267Z
---

(no detail given — issues-store-rename both-exist read path leaks a JS stack trace — when .spec/.forum and .spec/.issues both exist, the WRITE path fails loud with a clean one-line 'spex issue: <msg>', but the READ path (spex issue ls) prints the same loud message followed by a raw stack trace. Behavior is correct (both fail loud, name both dirs, give the repair, never merge) — cosmetics only: the read path should catch and print the same clean line. Found during the v0.3.0 re-measure campaign (C2).

Spec: issues-store-rename)
