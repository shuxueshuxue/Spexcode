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
      watcher. The rename writes the session's global `session.json` (inside the watched store), but the
      store fs.watch is best-effort, so the explicit nudge is what makes the sub-second arrival a
      guarantee rather than watcher luck.
---

# measuring board-stream

YATU through the real HTTP surface: a live `spex serve`, a real `curl -N` SSE subscription, a real rename
POST — never a direct call into the module. The loss is the gap between "a rename shows up while you
watch" and "a rename waits out a cold tick": the nudge must push sub-second even when the best-effort
store watch never attached. (The stream's deeper delta-protocol equivalence is [[board-delta]]'s own measured contract.)
