---
scenarios:
  - name: live-owner-times-out-dead-owner-recovers
    tags: [cli]
    description: >
      From a fresh installed session-core consumer, have one process hold a session record lock while a second uses
      the nonblocking synchronous form and one ordinary waiter through the package's fixed bound, then terminate
      the owner and acquire the same lock from a new process. Exercise async cancellation while a live owner holds
      the lock.
    expected: >
      A live owner is never stolen: the nonblocking contender refuses immediately, the ordinary waiter reaches the
      fixed package bound and fails loudly, and the cancelled waiter fails loudly without entering. Once the owner
      is dead, the next process reclaims the same lock and enters exactly once.
---

# record-lock loss

Measure with independent processes through the installed `@spexcode/session-core/internal` entry so ownership and
PID reclamation are real operating-system facts.
