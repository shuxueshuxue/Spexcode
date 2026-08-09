---
scenarios:
  - name: one-off-at-session-explanation
    tags: [cli]
    description: >-
      In a launched supervisor session, request an explanation from `@<session>` and inspect the supervisor's
      immediate command plus the worker's return route.
    expected: >-
      The supervisor uses `spex session send <id> "<question>"` for this point-to-point request; the worker's
      reply hint returns over send. It creates no watch and backgrounds no wait for a one-off answer.
  - name: owned-lifecycle-supervision
    tags: [cli]
    description: >-
      In a launched supervisor session, give the supervisor ongoing responsibility for a dispatched worker or
      an existing worker whose lifecycle it explicitly owns, then end that responsibility.
    expected: >-
      The supervisor uses durable watch delivery only for that owned lifecycle, remains parked while managed
      delivery exists, and cancels a manual watch when the ownership ends. It backgrounds `spex session wait
      <child>` only when it needs the next lifecycle transition and has no managed-watch delivery.
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
trail. These are routing boundaries: the evidence must show the chosen command and the absence of the excluded
supervision or product-object path.
