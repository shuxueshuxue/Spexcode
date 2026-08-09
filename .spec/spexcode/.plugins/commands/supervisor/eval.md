---
scenarios:
  - name: automatic-parent-watch-no-duplicate
    tags: [cli]
    description: >-
      In a launched supervisor session, create a child with `spex session new`, inspect `spex session watch
      list`, and observe the child's next authored state transition in the parent.
    expected: >-
      `session new` creates the parent-child relation and installs exactly one managed `parent` watch
      automatically. `watch list` exposes that existing relation/source; the supervisor does NOT issue a
      manual `spex session watch <child>`, and the child transition arrives through the managed send-backed
      delivery without a duplicate message.
  - name: manual-watch-traffic-boundary
    tags: [cli]
    description: >-
      In a launched supervisor session, deliberately supervise an existing session with `spex session watch
      <id>`, inspect its source, drive more than one authored state transition, then run `spex session watch
      cancel <id>` and drive one more transition.
    expected: >-
      Manual watch is described and used as ongoing supervision, not a one-off wait: it adds a `manual` source,
      every future AUTHORED state transition queues a message to the watcher, and that continuing traffic/noise
      is present until `watch cancel` removes the manual source. After cancellation, no later transition arrives;
      cancellation leaves any independent `parent` source intact.
  - name: one-off-at-session-explanation
    tags: [cli]
    description: >-
      In a launched supervisor session, request an explanation from `@<session>` and inspect the supervisor's
      immediate command plus the worker's return route.
    expected: >-
      The supervisor uses `spex session send <id> "<question>"` for this point-to-point request; the worker's
      reply hint returns over send. It creates no watch and backgrounds no wait for a one-off answer.
  - name: wait-only-without-managed-delivery
    tags: [cli]
    description: >-
      In a launched supervisor session with no managed delivery for an existing target, request the next
      lifecycle edge and compare `spex session wait <id>` with `spex session watch stream <id>`.
    expected: >-
      `spex session wait <id>` is chosen only as a local next-lifecycle-edge read when no managed delivery
      exists; it is backgrounded and exits after the observed edge. The supervisor does not create a manual
      watch for this one edge, and `watch stream` is identified as human-only and never used as the agent wake-up.
  - name: herdr-external-research-suite-boundary
    tags: [cli]
    description: >-
      Give the supervisor Herdr's frozen corpus, manifests, runner, and scored baselines as research material,
      then inspect the work it proposes for the base product.
    expected: >-
      Those assets remain an external research suite. The base product receives only an eval declaration and
      filed evidence; no frozen suite asset lands under the product tree and no research-station product object
      is created.
---

# supervisor -- comprehension

Exercise the resolved `/supervisor` preset through a governed session and inspect the ordinary session command
trail. The evidence must show automatic parent delivery without a manual duplicate, deliberate manual-watch
traffic and cancellation, point-to-point send, the local wait fallback only when no managed delivery exists, the
human-only stream boundary, and the unchanged external Herdr research-suite boundary.
