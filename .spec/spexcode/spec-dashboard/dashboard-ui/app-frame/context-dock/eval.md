---
scenarios:
  - name: routed-spec-context-is-real
    description: A routed spec document's CONTEXT dock shows exactly two sections — the node's scenario states and its open issues — and no Backlinks panel anywhere; each row opens its own detail document.
    expected: Playwright opens a node with both projections, captures a settled screenshot showing Scenarios and Issues and no backlinks heading, and clicking a scenario row and an issue row changes the hash to #/evals/<node>/<scenario> and #/issues/<id> respectively.
    tags: [frontend-e2e, desktop]
---
