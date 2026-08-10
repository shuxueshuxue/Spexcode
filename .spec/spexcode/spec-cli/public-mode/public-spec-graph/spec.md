---
title: public-spec-graph
status: active
hue: 150
desc: Deterministic static Spec Graph publishing surface with no sessions, issues, evals, or write-capable backend.
code:
  - spec-cli/src/public-graph.ts#buildPublicGraph
related:
  - scripts/public-graph-build.mjs
  - ops/nginx/spexcode-public-graph.conf
  - spec-dashboard/src/public-mode.js
  - spec-cli/src/cli.ts
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/Root.jsx
  - spec-dashboard/src/Dashboard.jsx
  - spec-dashboard/src/SideBar.jsx
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/data.js
  - spec-dashboard/vite.config.js
  - spec-cli/src/public-graph.test.ts
  - spec-dashboard/src/publicGraphMode.test.mjs
  - spec-dashboard/test/public-graph-static.e2e.mjs
  - package.json
---
# public-spec-graph

The public graph is a **static read-only projection** of one Git repository's `.spec` tree. It is a
different surface from `spex serve --public`: it must never start or proxy a backend, expose sessions,
issues, evals, terminals, settings, or any write route. A visitor gets the graph and can open a node's
spec prose; every other top-level dashboard entry remains visible but disabled so the product shape is
legible without implying an unavailable capability.

`spex graph --public --out <path>` writes `spexcode.public-spec-graph/v1` JSON containing the producer
repository identity, exact Git `revision`, a relocatable `sourceRoot: "."`, and deterministic node rows.
The index retains graph-reading fields (`id`, `parent`, `path`, title/status metadata, governance paths),
while `--content-dir <path>` writes one `spexcode.public-spec-document/v1` JSON document per node with its
rendered spec body/parts. Runtime sessions, overlays, issue/eval summaries, and write affordances never
enter either payload. The same command without `--out` writes identical index bytes to stdout.

`npm run build:public` builds the dashboard with `VITE_PUBLIC_GRAPH_ONLY=1` and copies that snapshot plus
the per-node documents under `specs/` beside the static assets. The graph-only client reads the small
index first and fetches only the selected document, never opens
`/api/graph`, SSE, session, issue, eval, settings, or terminal transports, and routes all unknown hashes
back to `#/graph`. The artifact is therefore safe to serve from an ordinary static host. A future
scheduled GitHub consumer may replace the immutable snapshot/artifact for a repository and map its
normalized GitHub name to `<project>.spexcode.net`; that transport stays outside this product node until
the generic consumer has an explicit deployment owner. The first approved host is
`herdr.spexcode.net`; nginx serves it from an isolated release root and never reuses the existing
`spexcode.net` documentation root.

The build also emits `public-spec-release.json` with schema `spexcode.public-spec-release/v1`: the exact
revision plus the path, byte count, and SHA-256 of the index and every document. This is the handoff
contract for that future transport. Its daily job is deliberately boring: allowlist a public
`owner/repository`, fetch its selected revision into an isolated checkout, build and verify the manifest,
compare it with the candidate bytes, then atomically switch that repository's already-configured
`<repository>.spexcode.net` release directory. A fetch/build/verification failure preserves the last
known-good release and reports failure; it never publishes a branch tip directly, guesses a hostname, or
changes DNS/TLS. Repository-name collisions require an explicit registry decision.
