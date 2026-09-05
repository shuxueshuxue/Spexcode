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
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/GraphView.jsx
  - spec-dashboard/src/SideBar.jsx
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/PublicGraphAbout.jsx
  - spec-dashboard/src/data.js
  - spec-dashboard/src/route.js
  - spec-dashboard/src/specContent.js
  - spec-dashboard/src/launch.js
  - spec-dashboard/src/FileTree.jsx
  - spec-dashboard/src/project.js
  - spec-dashboard/src/tabs.js
  - spec-dashboard/src/workspace.jsx
  - spec-dashboard/src/specTreeState.js
  - spec-dashboard/vite.config.js
  - spec-cli/src/public-graph.test.ts
  - spec-dashboard/src/publicGraphMode.test.mjs
  - spec-dashboard/test/public-graph-static.e2e.mjs
  - package.json
---
# public-spec-graph

The public graph is a **static read-only projection** of one Git repository's `.spec` tree. It is a
different surface from `spex serve --public`: it must never start or proxy a backend, expose sessions,
issues, evals, terminals, settings, or any write route.

A visitor reads it through the **same workspace shell the live dashboard uses** — the rail, the explorer,
the tab strip, the document — landing on `#/spec`, the address a live project opens on. There is no second
sealed frame to keep in step, and no marker on the rail that the live rail does not also have: a published
tree is the workspace over a static payload, and the only thing that differs is which doors have data behind
them. `PUBLIC_PAGES` names the ADDRESSES a static payload can answer — Spec, File, and the directly
addressable Graph — while the rail carries the ordinary `RAIL_PAGES` entries with everything outside that
set visible but disabled. The product shape stays legible without implying a capability the payload cannot
answer, and without inventing an entry that exists only here.

`spex graph --public --out <path>` writes `spexcode.public-spec-graph/v1` JSON containing the producer
repository identity, exact Git `revision`, a relocatable `sourceRoot: "."`, and deterministic node rows.
The index retains graph-reading fields (`id`, `parent`, `path`, title/status metadata, governance paths),
while `--content-dir <path>` writes one `spexcode.public-spec-document/v1` JSON document per node with its
rendered spec body/parts. Runtime sessions, overlays, issue/eval summaries, and write affordances never
enter either payload. The same command without `--out` writes identical index bytes to stdout.

`npm run build:public` builds the dashboard with `VITE_PUBLIC_GRAPH_ONLY=1` and copies that snapshot plus
the per-node documents under `specs/` beside the static assets. The published client reads the small index
first and fetches only the selected document, never opens `/api/graph`, SSE, session, issue, eval, settings,
or terminal transports, and normalizes every hash outside `PUBLIC_PAGES` back to `#/spec`.

**Which source a reader reads is a property of the BUILD, never of the call site.** A body, a node's
attachments, a launcher list: each resolves from `PUBLIC_GRAPH_ONLY` at its one definition, so a surface
that never heard of publishing is still right in both builds. A call site that has to remember to pass a
flag is a call site that will eventually forget, and forgetting means a static page firing a request only a
backend could answer. Where a published tree genuinely has no data — the source files under the explorer's
Files section — the surface is not rendered at all rather than rendered empty. The artifact is therefore safe to serve from an ordinary static host and never reuses the
`spexcode.net` documentation root. Public boot reads the graph index once; static graph and document JSON use
conditional `no-cache` revalidation, so an unchanged release can answer from the browser's cached body after an
ETag check. The public mode never polls or opens a long-lived stream.

Because the shell is the real one, its REMEMBERED state has to be scoped like the real one too. Persisted
workspace state — open tabs, the dock, the split, the explorer's open branches — belongs to the tree the page
was served from, not to the origin. One host serves many trees: the gateway's `/p/<id>` projects, and a
gallery's several published trees under a single domain. `localStorage` is per-origin, so an unsuffixed key
hands a reader the tabs of whichever tree they looked at last — a vConsole page showing a `requests` tab. The
serving directory is the tree's identity here for the same reason it is the API prefix: it is the address the
page was actually served under. A root deployment keeps the bare key so an existing install boots with the
state it already had.

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

The About panel's trigger rides the status bar, but the PANEL is a viewport overlay and has to be positioned
and styled as one. A status strip clips each item's overflow and sets `white-space: nowrap` — both correct for
a one-line status, both fatal for a 250px panel of prose parented inside one: it lays out, measures correctly,
and paints nothing, which is exactly how it was found. Being a descendant of the strip is a DOM fact; being an
overlay is what it is.

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
