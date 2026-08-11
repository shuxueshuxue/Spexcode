---
title: public-spec-graph
status: active
hue: 150
desc: Deterministic static Spec Graph publishing surface with no sessions, issues, evals, or write-capable backend.
code:
  - spec-cli/src/public-graph.ts#buildPublicGraph
related:
  - scripts/public-graph-build.mjs
  - scripts/public-graph-registry.json
  - spec-dashboard/src/public-mode.js
  - spec-cli/src/cli.ts
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/Root.jsx
  - spec-dashboard/src/Dashboard.jsx
  - spec-dashboard/src/SideBar.jsx
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/PublicGraphAbout.jsx
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
back to `#/graph`. The artifact is therefore safe to serve from an ordinary static host and never reuses the
`spexcode.net` documentation root. Public boot reads the graph index once; static graph and document JSON use
conditional `no-cache` revalidation, so an unchanged release can answer from the browser's cached body after an
ETag check. The public mode never polls or opens a long-lived stream.

A registry is the sole repository-to-host mapping. Every publication explicitly names its repository, its
`id`, its hostname, and the About-panel copy; neither the build nor the deployment derives a hostname from a
checkout name. That REFUSAL is the product — the build rejects an unregistered id — while WHICH publications
exist is one deployment's fact, so `--registry <path>` lets a deployment supply its own list instead of
editing this repository to publish a second repository. `scripts/public-graph-registry.json` is the default
and holds SpexCode's own publication; it sits beside the only thing that reads it rather than in a top-level
directory of its own. The serving vhost is not here at all: an nginx server block naming one host's paths is
deployment configuration and lives with the deployment. The current SpexCode row maps
`shuxueshuxue/spexcode` to `spexcode.spexcode.net`. `herdr.spexcode.net` is a retired trial alias and may only
redirect to the registered SpexCode host; it must never keep serving SpexCode content as if Herdr owned it.

The build also emits `public-graph-meta.json`, a lazy static source for the floating About panel, and a
`spexcode.spec.zip` archive rooted at `.spec/` and made from the graph revision's `.spec/spexcode` tree. The panel offers the
archive download always and a repository link only when the publication names one — the shell also renders
[[flat]]'s locally produced sites, whose source may be a path with no forge behind it, and a link labelled
for a forge the source does not live on would be a claim rather than a fact. Its human-readable summary and
facts come from the metadata beside the graph. It
does not load during graph boot and it never reaches a backend. `public-spec-release.json` has schema
`spexcode.public-spec-release/v1`: the exact revision plus the path, byte count, and SHA-256 of the index,
metadata, archive, and every document. This is the handoff contract for the generic transport. Its daily job
is deliberately boring: allowlist a registered public `owner/repository`, fetch its selected revision into an
isolated checkout, build and verify the manifest, compare it with the candidate bytes, then atomically switch
that repository's already-configured release directory. A fetch/build/verification failure preserves the last
known-good release and reports failure; it never publishes a branch tip directly, guesses a hostname, or
changes DNS/TLS. Repository-name collisions require an explicit registry decision.
