---
title: dashboard-shell
status: active
hue: 200
desc: The desktop dashboard's root shell + shared substrate — the App.jsx root/router, the data.js polled-board layer, and the global styles.css — that every dashboard feature renders within.
code:
  - spec-dashboard/src/App.jsx#App
related:
  - spec-dashboard/src/Dashboard.jsx
  - spec-dashboard/src/PageScroll.jsx
  - spec-dashboard/src/data.js
  - spec-dashboard/src/project.js
  - spec-dashboard/src/heartbeat.js
  - spec-dashboard/src/streamHeartbeat.test.mjs
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/theme.js
  - spec-dashboard/THEME-CREDITS.md
---
# dashboard-shell

## raw source

The dashboard's feature nodes (node-graph, keyboard-nav, the session views…) all mount inside
one root component, poll through one data layer, and style against one global stylesheet. That substrate
has no single feature owner, so co-owning it fanned every shell/style edit across all of them. Give it a
foundation node; features REFERENCE what they touch via `related:` instead of co-owning it.

## expanded spec

dashboard-shell owns the cross-cutting dashboard files: `App.jsx` (the entry — it boots the one shared data
layer, owns the fail-loud boot below, picks the face by viewport width, and is the **one writer of the
tab head**: `document.title` and the favicon are written only from *resolved* route-selected identity —
while the catalog/board probes are still pending the static boot document stands untouched, because a
placeholder default in the head poisons the browser's per-URL favicon memory, [[side-nav]]),
`Dashboard.jsx` (the desktop
root — it mounts the [[side-nav]] rail and swaps the routed page through **one shared page-pane
boundary**: every page gets the same pane and the same loading fallback, and warm pages — the graph, the
session board — declare warmth to stay mounted and display-toggle across switches), `data.js` (the shared polled board
data every view reads), and `styles.css` (the global stylesheet). **The project scope is a shell concern**
([[projects-hub]]): `project.js` reads the served pathname once (`/p/<id>/` vs the root) and every `/api`
URL in the data layer — fetch, SSE, the terminal WebSocket — routes through its one prefixing seam, so a
scoped page talks to `/p/<id>/api/*` while an unscoped serve stays byte-identical to before; the entry's
face pick extends the same way (a scoped 401 raises the shared credential gate instead of the error panel,
and the root address with no board but a live `/projects` surface boots the hub face instead of the
classic dashboard). Route params that belong to a feature
(`#/issues/<id>`, `#/evals/<node>/<scenario>`) pass through this shell unchanged; the destination feature
owns their meaning. The app-resident data the shell holds beside the board (the issues list and its
throttled reloader) reaches BOTH faces — the phone face renders the same routed review pages, so it
receives the same resident props the desktop does. The shell applies an incoming routed selection before it echoes a page's local selection
back into the hash, so an external door to `#/sessions/<id>` or another detail route is never overwritten by
the previously-selected tab during the page switch. Likewise, feature-level shared widgets may add compact
global style vocabulary here when the rule is genuinely reused across shell surfaces. **Each face is its own lazy chunk**, and
the desktop root lazy-loads its heavy leaves (the session console with xterm, the evals/issues pages with
the annotator) the same way — so the phone face ([[mobile-ui]]) never downloads the graph or terminal
libraries, and the first graph paint doesn't wait on them either; the split moves bytes only, never
behaviour. The split's one failure mode is owned here too: after a dist rebuild a still-open page asks for
OLD hashed chunks the server no longer has (the gateway answers 404, never HTML — [[public-mode]]), so the
shell catches the failed chunk load (`vite:preloadError`) and **reloads once** onto the fresh index.html —
a deploy under a live tab costs one automatic reload, never a blanked app; a failure that persists right
after that reload surfaces as the normal error instead of a reload loop. The board **focus survives a reload or a mobile↔desktop breakpoint remount within its tab**
(session-scoped, so a fresh tab still opens on the root). A feature node lists whichever of these it touches under
`related:`, so editing the shell or the stylesheet attributes its drift and eval staleness here rather than to every
feature (see [[governed-related]]). This is the dashboard twin of [[sessions-core]]: one owner for the
substrate, references everywhere else.

**One palette, many themes.** The whole app — the spec-node board, the react-flow canvas, AND the
session console — draws its colours from one set of CSS custom properties (`--paper --panel --panel2
--line --ink --ink2 --muted`, the accents `--blue/--green/--red/--yellow/--orange/--magenta/--cyan`,
`--term-bg`). Because every rule reads through those vars, a
theme is nothing but another definition of them. Every theme is a **community preset** — design
tokens ported from MIT-licensed themes in the official Obsidian community catalog (Minimal, Things,
Tokyo Night, Catppuccin Mocha, Everforest, Gruvbox, Rosé Pine Dawn, Dracula; palette values only,
never upstream CSS rules or per-component
branches — every upstream license is independently verified at porting time and the notices are
preserved in `spec-dashboard/THEME-CREDITS.md`).
**Minimal is the default** and lives as the bare `:root` var set, so even an unthemed `<html>` paints
Minimal; each other preset is one `:root[data-theme=<code>]` row over the same vars. Flipping
the one `data-theme` attribute on `<html>` re-skins board and console together, with no per-component
theme logic. The theme identity stays ONE flat code — no family × light/dark axes, and no base
light/dark pair: the legacy `light`/`dark` themes are retired. The embedded
terminal stays dark in every theme (the Claude TUI is dark-designed), so `--term-bg` is a neutral
near-black under light palettes and each dark preset's own deepest surface. Even the
**scrollbars** read through the palette: `styles.css` themes them globally (a thin, rounded thumb —
`--line` at rest, `--muted` on hover, over a transparent track) via `::-webkit-scrollbar*` for Blink/WebKit
and `scrollbar-color`/`scrollbar-width` for Firefox, so every scrollable pane matches the app in every
theme with no per-surface rule and no raw-OS default. The terminal is styled only at its edge; xterm keeps
its viewport geometry so scrollback and TUI wheel paths stay truthful.

`theme.js` owns the pick: `getTheme()` returns an explicit saved choice (`localStorage
spexcode.theme`, validated against the THEMES list) and resolves anything else — absent, garbage, or
a legacy `light`/`dark` value from before those themes were retired — to the Minimal default; there
is no system `prefers-color-scheme` axis. `applyTheme(t)` sets the `data-theme` attribute and
persists. To avoid a wrong-palette flash before the module boots, `index.html` runs a tiny inline
script in `<head>` that applies the same choice (same fallback to Minimal) to `<html data-theme>`
before first paint — its inline code list mirrors THEMES and must move with it. The [[settings]]
page carries the live picker; preset labels are proper nouns and deliberately untranslated.

**One document scrollport.** The shell's page pane defines the available viewport, while [[page-scroll]]
is the one overflow owner used by document-shaped pages. Pages contribute content width and sticky
children, never another full-page scrollbar. Graph camera geometry, session panes, terminal scrollback,
and bounded overlays keep their own non-document contracts.

**One type system.** Dashboard chrome reads font size, line height, weight, and letter spacing from one
small semantic scale in `styles.css`: caption/meta, control, body, subtitle, title, heading, and display
roles, plus shared leading and weight roles. A component chooses the role its text performs; it never
invents a nearby pixel value to make one label fit. The scale keeps ordinary UI text readable, reserves
the smallest role for genuinely secondary metadata, and gives the graph, sessions, evals, issues,
settings, overlays, and phone face the same hierarchy. Compactness comes from layout and spacing rather
than shrinking copy below the scale. Responsive display copy may own a fluid scale token, but the formula
still lives with the shared tokens rather than at its callsite. Letter spacing is neutral across the app;
hierarchy comes from size, weight, colour, and case, not scattered tracking values. The embedded terminal
uses the same family and a shared terminal-size token at its xterm adapter boundary, so its numeric API
does not become a second typography source.

**Fail-loud boot.** A board that never arrives (backend down, proxy dead) shows an **error + retry panel**,
never an eternal spinner — the pre-first-board window is the only reader; once a board has landed, a failed
refetch keeps the last good board and the stream/poll below keep retrying on their own. The **catalog
projection keeps last-good the same way**: it is identity-bearing, so a blipped poll (an `absent` answer
after a proven catalog — a gateway restart mid-poll) never regresses a resolved identity to the anonymous
default; a fresh `ok` or `denied` always applies — denied is an answer, a mid-session lock must re-gate.

**Push-first board — freshest-issued wins.** The shell keeps the board fresh through three paths. The
primary is the **delta subscription** ([[graph-stream]]/[[graph-delta]]): whole boards arrive over the push
channel — a full on connect, then patches the data layer applies to its unit-map mirror — straight into
state, no refetch per change; a patch whose chain tag mismatches reopens the stream and re-anchors on the
fresh full. Second, an **on-demand** `reload()` (`/api/graph`): a session close/rename calls it so every
surface reflects the change at once, and an old backend that only speaks bare `board-changed` downgrades the
subscription to exactly this refetch path. Third, a **slow fallback poll that always runs** as the final belt. Between them a **heartbeat dead-man switch**
holds the stream to its contract: the server pings on a fixed cadence, so silence past 2.5× that window means
the stream is DEAD (half-open tunnel, sleep-resume, frozen tab), not merely quiet. The cadence primitive, the
derived dead window, and the switch itself live in ONE shared client heartbeat module (`heartbeat.js`) that the
terminal socket ([[reconnect]]) reads too — one constant for the whole client, held equal to the server's two
ping cadences by test, never a per-channel copy. Detection is **event-driven, not a polling loop**: every
stream event (pings included) re-arms one one-shot timer, so on a healthy link liveness costs zero wakeups and
nothing ever fires. On a breach it reopens (board-full re-anchors and repaints), re-arms to keep watching the
replacement, and kicks the ETag refetch, so catch-up is instant; a frozen tab runs no timers, so its overdue
one-shot fires on resume and converges likewise. The poll's cost is zeroed by conditional
requests: `loadGraph` sends `If-None-Match`, an unchanged board answers a bodyless 304 and the shell skips
the repaint, so no failure mode is staler than the poll period. That guarantee holds only while the
conditional key is the identity of the board actually DISPLAYED: the ETag latches when its body paints
(never from a response a fresher board superseded), and a pushed board clears it — the display's identity
is then a delta-chain tag the HTTP lane can't express, so the next poll goes unconditional once and
re-earns its 304s from a painted response. A key that outlives its paint would let the poll 304 forever
against a board nobody sees, turning push-delivered staleness permanent. Because pushed boards and in-flight fetches can
interleave, the shell stamps every application with a monotonic sequence — a pushed board is freshest by
channel order, so it bumps the sequence and invalidates any older fetch still in flight; a superseded
response is dropped, never painted. Without that guard a just-closed session resurrects: the post-close
reload paints the row gone, then a stale in-flight snapshot lands late and flickers it back. The guard makes
a removal stick the moment its own reload lands.
