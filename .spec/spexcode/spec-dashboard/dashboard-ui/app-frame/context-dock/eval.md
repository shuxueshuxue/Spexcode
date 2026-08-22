---
scenarios:
  - name: routed-spec-context-is-real
    description: A routed spec document shows resident backlinks and latest scenario states in the right CONTEXT dock; each row navigates to its canonical document or eval address.
    expected: Playwright opens a node with both projections, captures a settled screenshot, and clicking a backlink and a scenario changes the hash to #/spec/<id> and #/evals/<node>/<scenario> respectively.
    tags: [frontend-e2e, desktop]
---
