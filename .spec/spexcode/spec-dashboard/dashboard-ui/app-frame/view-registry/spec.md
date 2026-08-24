---
title: view-registry
status: active
hue: 225
desc: Address kind → view and surface, with one route-props contract for every view.
code:
  - spec-dashboard/src/views.jsx
related:
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/viewRegistry.js
  - spec-dashboard/src/route.js
  - spec-dashboard/src/tabs.js
---
# view-registry

The map from an address kind to the thing that renders it, its surface, and the single contract a view signs:

> **A view receives `{ param, query }` as props and does not read the global address.**

## Extension boundary

The core map is seeded into one runtime registry. Product extensions use its `registerView(name,
definition, owner)` or `registerPlugin({ id, views })` API; they do not mutate the exported core object.
Names are lowercase kebab-case, every definition must provide a callable component or a tagged React
component object such as `React.lazy`, and registration is
fail-closed: an existing core or plugin view cannot be replaced. Plugin registration validates every view
before mutating the registry, so a collision leaves all prior entries intact. A plugin can be removed by id,
which removes only the views it owns. The registry is the sole lookup used by `viewFor`, `surfaceFor`, and the
document predicates, so an extension receives the same route-props contract and shell ownership as a built-in
view. This is an extension seam, not a second navigation system: plugins provide views, while routing and tab
identity remain shell-owned.

The existing Settings destination is the first built-in extension that enters through this API at startup.
Its plugin supplies only the view definition; the canonical `#/settings` address, rail destination, resident
tab identity, and workspace host remain owned by the same route and shell modules as every core view.

Everything else it needs — the board, the workspace — it asks for by context, so no component has to own
another component's props. That is what dissolved the god component: its size was not the problem, its
*ownership* was.

**The contract stopped being optional the day documents began outliving their turn on screen.** Two views
— the evals and issues boards — read the global address instead of their props, and nothing broke while
every view was unmounted the moment it stopped showing. Under [[workspace-shell]]'s mounted-document pool a
view that reads the global address follows the reader out of its own pane: a hidden board would re-derive
itself from whatever was opened next. Both now take `{ param, query }` like everything else, and the cold
review entry hands them the same props the shell does.

**`surface` is the shell boundary.** `workspace` owns Explorer, tab strip, document pool, and dock;
`workspace` owns the evals/issues board and detail layout with the shared Explorer/tab strip/working set;
Issues omits the activity rail while retaining the shared strip. Settings is a resident workspace tab. The
registry is the single source for view ownership and document/residency policy; the root mounts the shared
workspace host for these routes both on a cold URL and after in-app navigation. A review view cannot acquire a
second surface's chrome because no standalone review host exists.

**`document(page, param)` marks what [[tab-strip]] may hold**, and the strip asks the registry rather than
keeping its own list. Spec, Evals, Issues, and Settings are resident top-level tabs; parameterized Spec,
Evals, and Issues detail routes canonicalize their tab identity to the resident address while preserving
detail URL state. The user-facing
distinction between object documents and bare board destinations is owned by [[tab-strip]]/[[workspace-shell]];
this node supplies the machine predicate, storage normalization, and the optional `icon` identity used by
both the activity rail and resident workspace tabs. A page icon has one owner here; consumers do not keep
parallel page-to-glyph maps.

Left out: graph (including its focused node — an addressable legacy view that is no longer a workspace
destination), bare sessions, and `empty`, which is a real non-document
workspace state. **`/sessions/new` was a document and is not one now**: it names no
session, so the predicate takes the selector's VALUE and not merely its presence — the launch page is a
form, and the session it starts becomes a document the moment it has an id.

**A rail destination is not the same thing as an addressable kind.** `spec` and `file` are addresses you
arrive at by opening something; there is no "go to the spec page" the way there is a sessions page. Spec is
still a resident tab once opened, but it is not a rail destination. The rail therefore has its own list, and
the first version of this without that split threw `unknown icon: spec` — the rail had faithfully tried to
draw a destination that does not exist.

**Each view is lazy and pays for its own libraries.** The graph carries xyflow and mounts its own
ReactFlowProvider; hoisting that into the shell would drag the whole graph library into every face's entry
chunk, including the phone's and the sealed public build's. The retry that survives a stale dist lives here too, wrapped
around every importer, because `React.lazy` caches the rejection — a chunk that 404s once is a dead view
for the life of the page, and the importer is the only place a second attempt is still possible.
