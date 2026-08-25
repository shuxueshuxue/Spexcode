---
scenarios:
  - name: review-route-in-resident-shell
    test: spec-dashboard/src/reviewWorkspaceContract.test.mjs
    tags: [desktop]
    code: [spec-dashboard/src/Root.jsx]
    related: [spec-dashboard/src/App.jsx, spec-dashboard/src/views.jsx]
    description: >
      Read the root and the view registry as the product ships them: the root's route selection, and the surface
      each review view (evals, issues) declares.
    expected: >
      The root mounts one App for every address and selects no lighter review surface; every review view declares
      the `workspace` surface, so a cold `#/evals` or `#/issues` URL lands in the same resident shell — with its tab
      strip — that in-app navigation uses.
---
# measuring light-entry

The one-runtime rule is a structural claim about the root and the registry, so its instrument reads the shipped
source rather than driving a browser: a lighter review host cannot exist if no view declares a second surface
and the root selects none. The cold-boundary browser probe that measured the withdrawn fast path is retired with
it.
