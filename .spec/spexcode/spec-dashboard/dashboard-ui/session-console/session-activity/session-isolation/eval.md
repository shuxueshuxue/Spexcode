---
scenarios:
  - name: worktree-and-branch-are-visible
    tags: [frontend-e2e, desktop, mobile]
    description: >-
      Open the real dashboard against a graph containing a server session with both `source` and `branch`.
      Inspect its map glance row, desktop session-console row, and phone session row through the browser,
      then compare each badge with that same session record from the board response. Capture the settled
      desktop product surface.
    expected: >-
      Each shared row surface shows a compact isolated-worktree badge. Its branch text is exactly the
      server-record `branch`, its hover and accessible name preserve that exact value, and no local `source`
      pathname is visible. A row without `source` has no badge even if some other field resembles a branch;
      a source-backed row without a branch shows only the worktree identity. The headline, avatar, and status
      marker remain the existing shared row face.
---

# session-isolation measurement

Measure through browser-rendered shared rows against a real board response. Compare the DOM text and
accessible name with the response object in the same browser run; do not substitute a hand-written branch
fixture or read a terminal/configuration surface.
