---
scenarios:
  - name: direct-dependency-owners-and-exemptions
    tags: [cli]
    description: >-
      Read the committed dashboard package manifest and source import graph. Check that every direct dependency
      has a live importer or the explicit optional-desktop boundary, and that the CodeMirror, Markdown/KaTeX,
      shared-core, and public-ranker edges named by the dashboard spec remain reachable.
    expected: >-
      No direct dependency is an unexplained ingress: CodeMirror serves SourceView/DiffDocument, Markdown-it and
      KaTeX serve RichText, spec-core serves browser-safe shared projections, spec-cli serves only its public ranker,
      and Electron remains outside the root workspace. A new unowned dependency or removal of a required edge fails
      the accounting check during review.
    test: spec-dashboard/src/dependencyBoundary.test.mjs
  - name: board-renders
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard at http://localhost:5173, let the spec-graph settle, and look: the
      spexcode root and its package children render as node cards, each with its version and
      freshness. Capture the board and file it with
      `spex yatsu eval spec-dashboard --image <png> --pass`.
    expected: >-
      The spec-graph board renders every node card with its version and freshness badge; the
      filed reading carries the screenshot as image evidence and a pass verdict.
  - name: dashboard-build-prefix-portable
    tags: [frontend-e2e, backend-api]
    description: >-
      Build the dashboard dist, serve it at the root and below an arbitrary path prefix, and open a project
      through the real host gateway at both `/p/<id>/` and the bare `/p/<id>` address. Probe `/p/<id>/health`
      through the hub, exercise a lazy route, and inspect browser request failures and console errors.
    expected: >-
      The relative production dist boots at every served position with no failed requests; scoped `/assets/...`
      requests are served as shell bytes while extensionless backend routes still proxy (the real `/p/<id>/health`
      response is `ok` with a non-HTML content type); the scoped page uses `/p/<id>/api/...` calls, and the bare
      scoped address redirects to its slash-terminated form before assets load. The pre-change root-absolute dist
      fails under the arbitrary prefix, providing the A/B loss signal.
---
# eval.md — spec-dashboard

The dashboard's product surface is measured by **looking** (YATU): the agent screenshots the rendered
spec-graph board through the running app and files it as a reading — image evidence with a verdict, the
eval tab's first real picture, not a `blob: null` placeholder.
