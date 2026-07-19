---
scenarios:
  - name: review-targets-round-trip
    tags: [frontend-e2e, desktop]
    description: >-
      Through the running dashboard in a real browser, record a video while exercising the shared address
      chain from multiple surfaces. Pick a scenario result from the graph search palette and verify it lands
      on `#/evals/<node>/<scenario>` with the Evals detail rendered. Pick an issue result from the same
      palette and verify it lands on `#/issues/<issue-id>` with the Issues detail rendered. Then focus a
      node with issues, open its node-info Issues tab, click one IssueCard, and verify it lands on the same
      canonical Issues detail route. File with
      `spex yatsu eval address-routing --scenario review-targets-round-trip --video <webm> --pass`.
    expected: >-
      Every clickable review reference uses the shared app address chain. Search results and IssueCard
      anchors all project to canonical URLs through addressHash/navigateAddress;
      eval targets render the Evals detail, issue targets render the Issues detail, and none of these paths
      merely focuses the bound node or opens the node popup's eval tab.
    code:
      - spec-dashboard/src/address.js
      - spec-dashboard/src/Dashboard.jsx
      - spec-dashboard/src/SpecSearch.jsx
      - spec-dashboard/src/IssueCard.jsx
---
# eval.md — address-routing

Measure the actual navigation chain, not the helper in isolation: use a browser, click real search rows and
palette/card entries, and record the route plus rendered destination. This node owns the cross-cutting address
contract; surface scenarios prove their own display and affordance without duplicating this round-trip.
