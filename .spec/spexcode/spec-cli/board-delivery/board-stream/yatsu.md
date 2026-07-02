---
scenarios:
  - name: rename-nudge
    tags: [backend-api]
    code: spec-cli/src/boardStream.ts
    related: [spec-cli/src/index.ts]
    description: >-
      Subscribe to `/api/board/stream` (plain mode), then POST a rename to `/api/sessions/:id/rename`
      through the real API, and time the arrival of the next stream event.
    expected: >-
      The event arrives on the debounce scale (sub-second), NOT the ~15s cold tick — the rename route's
      explicit nudge (`notifyBoardChanged`, event source 0) reaches the same debounced funnel as every
      watcher, even though the rename writes the worktree's `.session`, which no fs.watch sees. The name's
      data home stays the worktree file alone (no store double-write).
---

# measuring board-stream

YATU through the real HTTP surface: a live `spex serve`, a real `curl -N` SSE subscription, a real rename
POST — never a direct call into the module. The loss is the gap between "a rename shows up while you
watch" and "a rename waits out a cold tick": the one mutation the watchers structurally cannot see must
still push. (The stream's deeper delta-protocol equivalence is [[board-delta]]'s own measured contract.)
