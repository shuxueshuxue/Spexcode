---
title: record-lock
status: active
hue: 280
desc: Cross-process session mutations share one filesystem record fence with bounded waits and dead-owner reclamation.
code:
  - spec-cli/src/session-record-lock.ts
related:
  - spec-cli/src/sessions.ts
---
# record-lock

The canonical project runtime tier holds one lock file per session id outside the session directory, so close
may remove the record while still fencing stale writers. Creation uses exclusive file creation, records the
owner PID, reclaims a dead owner, and bounds waits for a live owner. Async acquisition honors cancellation;
synchronous lifecycle writers share the same bytes. The nonblocking synchronous form exists only for product
input paths that must refuse instead of waiting behind an in-process transition.
