---
scenarios:
  - name: static-artifact-is-graph-only
    tags: [cli, frontend-e2e]
    description: >
      Build the public artifact through `npm run build:public`, inspect the emitted snapshot and load the
      compiled shell. The snapshot must identify one committed revision and contain readable node prose;
      the static mode must use that file rather than a live board and must leave the non-graph rail entries
      inert.
    expected: >
      `spec-dashboard/dist-public/public-graph.json` is a deterministic
      `spexcode.public-spec-graph/v1` index with a non-empty node list, `sourceRoot` equal to `.`, and no
      session, issue, eval, overlay, terminal, or checkout-path field. Its `specs/` documents carry the
      rendered prose separately, and `public-spec-release.json` hashes every static data file. The static
      application bundles successfully, opens the graph from the
      index, loads one document on node open, and has only graph navigation enabled. Zero loss =
      an ordinary static host can expose one repository's graph without exposing a live SpexCode control
      plane.
    code: [spec-cli/src/public-graph.ts, scripts/public-graph-build.mjs, spec-dashboard/src/App.jsx, spec-dashboard/src/Dashboard.jsx, spec-dashboard/src/SideBar.jsx]
    test: spec-dashboard/test/public-graph-static.e2e.mjs
  - name: isolated-release-host
    tags: [frontend-e2e, cli]
    description: >
      Publish one verified static release under the approved repository host without changing the existing
      documentation site. Check the host over HTTPS and fetch the graph manifest and one node document.
    expected: >
      `herdr.spexcode.net` serves the graph-only shell from the isolated public-graph release root, its
      manifest names the deployed source revision, the graph and one node document return successfully, and
      the existing `spexcode.net` documentation host remains unchanged. The release is activated only by
      switching the graph site's symlink; the docs site's root and publication marker are untouched.
    code: [ops/nginx/spexcode-public-graph.conf, scripts/public-graph-build.mjs]
    test: spec-dashboard/test/public-graph-static.e2e.mjs
---
# public-spec-graph — measurement

Run the public build from a committed product tree, then inspect the artifact and its browser behavior.
The public page is valid only if it can read the sealed snapshot without any dashboard backend.
