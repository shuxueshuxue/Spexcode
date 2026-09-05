---
scenarios:
  - name: published-tree-is-the-spec-face-with-no-backend
    tags: [cli, frontend-e2e]
    description: >
      Build the public artifact through `npm run build:public`, inspect the emitted snapshot, then load a
      published tree in a real browser and open one node. The snapshot must identify one committed revision
      and carry readable node prose. The page must be the ordinary workspace — rail, explorer, tab strip,
      document — landing on the Spec face, and it must reach no backend at all: every request it makes has
      to be answerable by a static host.
    expected: >
      `dist-public/public-graph.json` is a deterministic `spexcode.public-spec-graph/v1` index with a
      non-empty node list, `sourceRoot` equal to `.`, and no session, issue, eval, overlay, terminal, or
      checkout-path field. Its `specs/` documents carry the rendered prose separately;
      `public-graph-meta.json` drives the lazy About panel; `public-spec-release.json` hashes every static
      data file plus the `.spec` ZIP archive. Loaded in a browser, the bare address resolves to `#/spec`
      with the explorer's Specs tree and the node document beside it, the rail offers exactly the
      `PUBLIC_PAGES` doors (Spec and the Graph) with every other destination inert, opening a node reads
      `./specs/<id>.json`, and the network log contains ZERO `/api/` requests and zero page errors. Zero
      loss = an ordinary static host serves the real reading surface, and nothing on it can reach a control
      plane that is not there.
    code: [spec-cli/src/public-graph.ts, scripts/public-graph-build.mjs, spec-dashboard/src/App.jsx, spec-dashboard/src/route.js, spec-dashboard/src/SideBar.jsx]
    related: [spec-dashboard/src/specContent.js, spec-dashboard/src/NodeView.jsx, spec-dashboard/src/launch.js, spec-dashboard/src/FileTree.jsx]
    test: spec-dashboard/test/public-graph-static.e2e.mjs
  - name: remembered-state-does-not-cross-published-trees
    tags: [frontend-e2e]
    description: >
      In one browser profile, open one published tree, open a node there, then navigate to a DIFFERENT
      published tree served from the same domain. Read the second tree's tab strip.
    expected: >
      The second tree shows only its own tabs. Persisted workspace state — tabs, dock, split, the
      explorer's open branches — is keyed by the directory the page was served from, so a gallery of trees
      under one domain does not share one `localStorage` bucket. Zero loss = a reader who browsed
      `psf/requests` and then opened `tencent/vconsole` never sees a `request-cycle` tab on the vConsole
      page.
    code: [spec-dashboard/src/project.js]
    related: [spec-dashboard/src/tabs.js, spec-dashboard/src/workspace.jsx, spec-dashboard/src/specTreeState.js]
  - name: isolated-release-host
    tags: [frontend-e2e, cli]
    description: >
      Publish one verified static release under the approved repository host without changing the existing
      documentation site. Check the host over HTTPS and fetch the graph manifest and one node document.
    expected: >
      `spexcode.spexcode.net` serves the graph-only shell from the registered isolated release root, its
      manifest names the deployed source revision, and the graph, About metadata, ZIP archive, and one node
      document return successfully. `herdr.spexcode.net` redirects to that registered host; the existing
      `spexcode.net` documentation host remains unchanged. The release is activated only by switching the
      graph site's symlink; the docs site's root and publication marker are untouched.
    code: [scripts/public-graph-build.mjs]
    related: [scripts/public-graph-registry.json]
    test: spec-dashboard/test/public-graph-static.e2e.mjs
---
# public-spec-graph — measurement

Run the public build from a committed product tree, then inspect the artifact and its browser behavior.
The public page is valid only if it can read the sealed snapshot without any dashboard backend.
