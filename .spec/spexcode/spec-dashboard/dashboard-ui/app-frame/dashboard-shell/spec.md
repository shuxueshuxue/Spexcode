---
title: dashboard-shell
status: active
hue: 200
desc: The desktop dashboard's root shell + shared substrate — the App.jsx root/router, the data.js polled-board layer, and the global styles.css — that every dashboard feature renders within.
code:
  - spec-dashboard/src/App.jsx#App
related:
  - spec-dashboard/src/BackendStatus.jsx
  - spec-dashboard/src/Root.jsx
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/GraphView.jsx
  - spec-dashboard/src/PageScroll.jsx
  - spec-dashboard/src/data.js
  - spec-dashboard/src/readSafety.test.mjs
  - spec-dashboard/src/project.js
  - spec-dashboard/src/heartbeat.js
  - spec-dashboard/src/streamHeartbeat.test.mjs
  - spec-dashboard/test/board-poll-bodyless.e2e.mjs
  - spec-dashboard/test/board-divergence-self-heals.e2e.mjs
  - spec-dashboard/test/board-digest-fallback.e2e.mjs
  - spec-dashboard/src/streamCtorThrow.test.mjs
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
data every view reads), and `styles.css` (the global stylesheet).

The route registry resolves every product page into the shared workspace host. Evals and Issues are resident
workspace tabs: cold links, list navigation, and detail navigation all render through the same Shell and
TabStrip, so the Spec/Session/File working set remains visible while a finding is focused. Issues omits the
activity rail by its page-owned dock policy but retains the shared tab strip. There is no second review chrome
tree or cold-only route path that can hide the working set; mobile reflows the same route family through its
responsive face. App owns the one global route subscription and passes the captured address into that mobile
view; the mobile face never creates a second global route reader.

**Backend reachability is one shell fact.** Every dashboard API read reports through the shared data transport.
A network refusal or gateway 502/503/504 marks the whole live dashboard offline, even when a page still holds a
last-good board. The frame renders one global offline banner with an explicit retry; a later reachable API
response clears it. Feature pages still show their precise local failure, but they do not own a second health
model and they never let last-good projections masquerade as current while the transport is down.

**The project scope is a shell concern**
([[projects-hub]]): `project.js` reads the served pathname once (`/p/<id>/` vs the root) and every `/api`
URL in the data layer — fetch, SSE, the terminal WebSocket — routes through its one prefixing seam, so a
scoped page talks to `/p/<id>/api/*` while an unscoped serve stays byte-identical to before; the entry's
face pick extends the same way (a scoped 401 raises the shared credential gate instead of the error panel,
and the root address with no board but a live `/projects` surface boots the hub face instead of the
classic dashboard). Route params that belong to a feature
(`#/graph/<node>`, `#/issues/<id>`, `#/evals/<node>/<scenario>`) pass through this shell unchanged; the destination feature
owns their meaning. The shell holds no app-resident Issues/Evals row collection beside the board: both
faces mount the same routed review pages, and those pages request only their current server slice through
[[paged-review]]. The board itself stays [[graph-lean]] summary data, never a back door that preloads either
review list. The shell applies an incoming routed selection before it echoes a page's local selection
back into the hash, so an external door to `#/graph/<node>`, `#/sessions/<id>`, or another detail route is never overwritten by
the previously-selected tab during the page switch. Likewise, feature-level shared widgets may add compact
global style vocabulary here when the rule is genuinely reused across shell surfaces. **Each face is its own lazy chunk**, and
the desktop root lazy-loads its heavy leaves (the session console with xterm, the evals/issues pages with
the annotator) the same way — so the phone face ([[mobile-ui]]) never downloads the graph or terminal
libraries, and the first graph paint doesn't wait on them either; once the viewport is known to be desktop,
the workspace face is prefetched in parallel with the first board request so a cold review URL does not
turn the board's legitimate build time into a second serial full-frame spinner. Mobile and the sealed public
face never prefetch that desktop chunk; the split moves bytes only, never
behaviour. The split's one failure mode is owned here too: after a dist rebuild a still-open page asks for
OLD hashed chunks the server no longer has (the gateway answers 404, never HTML — [[public-mode]]), so the
shell catches the failed chunk load (`vite:preloadError`) and **reloads once** onto the fresh index.html —
a deploy under a live tab costs one automatic reload, never a blanked app; a failure that persists right
after that reload surfaces as the normal error instead of a reload loop. The board **focus survives a reload or a mobile↔desktop breakpoint remount within its tab**
(session-scoped, so a fresh tab still opens on the root). A feature node lists whichever of these it touches under
`related:`, so editing the shell or the stylesheet attributes its drift and eval staleness here rather than to every
feature (see [[governed-related]]). This is the dashboard twin of [[sessions-core]]: one owner for the
substrate, references everywhere else.

**Static graph face.** When the build-time `VITE_PUBLIC_GRAPH_ONLY=1` flag is present, this shell has a
separate, sealed input: `public-graph.json` ([[public-spec-graph]]), not the live board. It fetches that
one static snapshot once, mounts the desktop graph, and never polls `/api`, opens SSE, reads the project
catalog, selects a mobile/hub face, or mounts a session/review/settings transport. The ordinary dashboard
keeps its live-board contract unchanged. The public face can read a node's embedded prose but its sidebar
is graph-only and its unknown hashes normalize back to `#/graph`.

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
default; a fresh `ok` or `denied` always applies — denied is an answer, a mid-session lock must re-gate. Once a catalog read answers `denied`, the shell pauses its retry poll until the credential gate reports an unlock; an answered authorization failure is not a five-second error loop.

**Push-first board — freshest-issued wins.** The shell keeps the board fresh through three paths. The
primary is the **delta subscription** ([[graph-stream]]/[[graph-delta]]): whole boards arrive over the push
channel — a full on connect, then patches the data layer applies to its unit-map mirror — straight into
state, no refetch per change; a patch whose chain tag mismatches reopens the stream, naming the position it
already holds so the server answers with the difference rather than a snapshot.

**A reopen resumes only what was verified.** The distinction is not liveness versus correctness by
accident — it is exactly which reopens may trust their own contents. A stream that went quiet, or a frame
that was missed or reordered, leaves this client holding a board it fingerprinted and believes, so it names
that position and is carried forward from it. A fingerprint that disagreed with the frame that produced it
leaves the opposite: the thing a resume would start from is the suspect, so that reopen discards and asks
for everything. Second, an **on-demand** `reload()` (`/api/graph`): a session close/rename calls it so every
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
one-shot fires on resume and converges likewise. **A stream that never came up is a breach like any other.**
The switch is armed from the subscribe instant for exactly that case, so the breach must re-arm even when
there is no EventSource to close — a constructor that throws (a blocked or failed origin) raises no error
event, so nothing else is watching it. Treating that as "nothing to reopen" and returning early is the one
shape that disarms the switch permanently: the stream is then tried once and never again, and recovery
falls silently to the poll. The poll's cost is zeroed by conditional
requests: `loadGraph` sends `If-None-Match`, an unchanged board answers a bodyless 304 and the shell skips
the repaint, so no failure mode is staler than the poll period.

**The conditional key is MEASURED, not remembered.** It is the fingerprint of the units this client is
actually holding — `tagOf` over [[graph-delta]]'s canonical bytes, computed here — never the tag the server
handed us. Echoing a server-issued tag is a receipt: it attests that a frame arrived, and says nothing
about what applying it produced, so a client whose apply had diverged would quote it with perfect
confidence and be answered 304 — the lane certifying a board nobody holds. A self-computed fingerprint
depends on the bytes on this machine, so that state cannot survive one exchange. It also retires the
key-outlives-its-paint hazard (issue #70) STRUCTURALLY rather than by discipline: there is no stored key to
go stale, only a function of the display, so no latch can be forgotten and no seal misplaced. What it names
is the board this client has ACCEPTED from the server, which is what a transfer decision is about; the
session-eval generation guard is a rendering policy layered above that and deliberately not part of it.

**Every applied frame is checked, and the check is the same computation as the key.** After applying a
patch the shell fingerprints what it now holds and compares it to the tag the frame was named with. Equal
discharges [[graph-delta]]'s equivalence obligation for that frame on this client, and the hash is then the
poll's conditional key — verification and the 304 lane are ONE computation, not two mechanisms. Unequal
means the apply produced a board the server never had: the chain check cannot see it (a patch whose
from/to line up but whose content does not), and it is the one state the equivalence proof exists to
exclude. So it is loud (`GRAPH-DIVERGENCE`, in the same register as [[graph-stream]]'s patrol repairs —
the target is zero) and it self-heals by reopening onto a fresh anchor. Measured with an injected patch
whose content contradicted its tag: detected in 15ms, replacement stream open 185ms later. The digest does not depend on a secure
context. `crypto.subtle` exists only in one, and this product's dashboards are opened over plain HTTP on
tailnet addresses — measured in Chromium, `isSecureContext` is false and `crypto.subtle` undefined on the
very address a human uses. A WebCrypto-free digest ([[graph-delta]]) therefore backs the platform one, so
this lane is live where the product actually runs rather than only on localhost and the TLS gateway; it
costs 17ms against WebCrypto's 4ms on a 429-unit board, 0.15% of the interval between frames. And if the
digest is unavailable for any reason at all, computing the key answers with NO key and the poll goes
unconditional — what the belt cost before there was a key. A missing digest may cost this lane its
CHEAPNESS; it may never cost the lane itself. A key computation that REJECTS takes `loadGraph` down with
it, and with it the fallback poll, the dead-man's kick and the retry, leaving a board that is stale forever
while the shell still reports the stream live — which is precisely the state everything here exists to make
unreachable.

Before this, that state was survivable only because the poll was resyncing unconditionally every period:
real recovery, but silent, ~15 seconds slow, and paid for with a full snapshot on every poll forever. The
fingerprint is what lets the cheap lane and the honest lane be the same lane.

**Both lanes name the board with the same tag, or the fallback stops being a fallback.** The server's
validator IS the delta chain's content tag ([[graph-cache]] computes the one identity; [[graph-delta]] owns
the algebra), so a push-delivered board is expressible on the conditional-request lane and the poll keeps
earning its 304s while the stream works. When the two lanes named the board differently the shell had no
way to say what it was holding, so every pushed frame dropped the key and the next poll went unconditional
— and because a patch arrives more often than the poll period on any board worth watching, "unconditional
once" was in practice unconditional always. Measured on the dogfood board before this was one tag: over 105
seconds, one tab, the stream delivered its whole job in a single full plus six patches totalling 53KB,
while the poll beside it re-downloaded the complete board five times out of seven — 3.2MB carrying, by unit
comparison against the board the client had already applied, zero changed units. The pathology inverted the
design: the better the push channel worked, the more full snapshots the belt behind it shipped. A fallback
whose cost scales UP with the primary's success is not a belt, it is a second primary nobody sized for. Because pushed boards and in-flight fetches can
interleave, the shell stamps every application with a monotonic sequence — a pushed board is freshest by
channel order, so it bumps the sequence and invalidates any older fetch still in flight; a superseded
response is dropped, never painted. Without that guard a just-closed session resurrects: the post-close
reload paints the row gone, then a stale in-flight snapshot lands late and flickers it back. The guard makes
a removal stick the moment its own reload lands.

That same envelope sequences session eval summaries ([[session-eval]]): within one backend epoch, a session
projection is accepted only when its generation is at least the last one displayed; an authoritative full
snapshot may rebase the epoch, while a chained delta may not regress it. Stream `ping` proves transport
liveness only. An error or dead-man breach marks resident summaries last-known without clearing their values;
only the next authoritative `graph-full` certifies them current again. This is client state over the existing
graph subscription, not a summary-specific EventSource, WebSocket, REST poll, or timer.

**The browser tab's title has one writer per face.** The workspace face names its own place — the shell is
the address reader, so it writes `place · project`; App stays silent there. App writes the plain project
title only for the faces with no address to speak of: the hub, the phone, and every pre-board state. Both
writing would race, and the parent effect runs last.
