---
title: issues-view
status: active
hue: 200
desc: The dashboard's Issues page — a top-level route (#/issues, [[side-nav]]) peer to the graph, the session board, and the Evals page, as a MASTER-DETAIL — the merged issue list (local + forge, store-tagged) on the left, a full-height detail pane the selection drives on the right; markdown-rendered bodies and threads, node chips focus the graph, the reply composer — a collapsed auto-growing bar DOCKED at the detail's foot — routes by store (local-store commit or real forge comment).
code:
  - spec-dashboard/src/IssuesPage.jsx
  - spec-dashboard/src/IssueCard.jsx
  - spec-dashboard/src/Thread.jsx
  - spec-dashboard/src/FilterSelect.jsx
  - spec-dashboard/src/textarea.js
related:
  - spec-dashboard/src/Evidence.jsx
---

# issues-view

## raw source

Issues are one object over every store ([[issues]]), and a human wants **one place** to read them — an
agent's local taste issue and a GitHub issue on the same node belong on the same page, not on two
surfaces the user must correlate. So the dashboard carries ONE **issues page** for them, a top-level page
of its own — a peer of the graph, the session board, and the Evals page ([[evals-view]]), never a tab
folded inside another surface (the earlier `Evals | Threads` switcher was collapsed by the human's
directive: evals and issues are two top-level pages, not one page with an in-page switch). The dashboard
stays a **thin window** over the CLI's truth, never a second source — it renders what `/api/issues`
returns and computes nothing, and every write goes through the SAME open/reply the CLI uses, committed
straight to the trunk.

## expanded spec

- **A top-level page of its own.** The page lives at `#/issues` with its own [[side-nav]] rail entry —
  bookmarkable, reloadable, a peer of the graph and the session board. The keyboard door is [[side-nav]]'s
  global ⌥ vocabulary — **⌥4** reaches it from any page, the console included. There is no board-side bare
  key and no console pill: the rail, ⌥4, or history is how you arrive; the leading loss surface's bare
  `f` / ⌥F go to the Evals page instead ([[evals-view]]). Esc never leaves the page ([[side-nav]]) — it
  stays with the page's own stack; going elsewhere is the rail, ⌥digit, or history.
- **The page is a MASTER-DETAIL — a full page deserves a full-height detail, never an expansion inside a
  box.** (The earlier pinned-two-region form was conceived for a height-starved overlay; on a routed full
  page it collapsed content into a small scrolling box — the human called it, and the form changed.) The
  **left column** is ONE box — the merged issue list under its own filter bar (first row: the store filter +
  the concluded-count chip; second row: **New beside the open/total meta, the meta at that row's END — the
  action never occupies the bar's head alone and the meta never leads**); the bar
  stays sticky over the full-height list, which scrolls itself. The rows are one compact line each, so the
  column stays **SLIM** — a picker, never a reading surface that starves the detail (the human called the
  wide sidebar) — and a **fold toggle** (the shared [[fold-toggle]] icon button) collapses it to a thin
  strip so the detail owns the width while one
  issue is being worked; the strip is the unfold affordance, and the folded list keeps its state (filters,
  selection, j/k) — the fold is pure geometry. The [[side-nav]] rail names the page, so the
  column carries no title of its own. The list CHROME is not this page's own dialect — it is the SAME
  grammar the [[evals-view]] picker wears: one filter-control language (ONE shared dropdown filter
  component — this store filter and the evals feed's kind filter are literally one control — with chips and
  New sharing that height and radius, the open/total meta at its row's end), uniform single-line rows that truncate rather than wrap, and the same
  unhurried spacing over a hairline-soft divider — so the two top-level pages read as ONE surface. The **right pane** is the full-height DETAIL of the one selection —
  **selection IS detail** (email-style, no Enter, no in-place expansion): an issue renders its markdown
  body. **j/k walk the issue list** (folded or not) and the detail follows; a key typed into an input is
  never captured.
- **One merged list, store-tagged — RESIDENT, never cold-fetched.** The list is the merged ISSUE list
  ([[issues]]'s `mergedIssues`) — which **excludes eval-remark threads** ([[eval-issue-split]]): a
  scenario-scoped concern is a remark, not an issue (I1), so it never shows in the drain here; it lives on
  the Evals page instead (the [[evals-feed]] row + the [[event-detail]] remark track). The list is app-held
  state beside the board (one data path): the page renders instantly from it on every visit; freshness
  inherits the board's own pattern — the push/change signal triggers a throttled refetch, the 15s cold lane
  backstops (forge-cache updates arrive nowhere else), and `GET /api/issues` answers **304 via ETag** so a
  no-change refetch costs headers only. A write forces the refetch so it shows up where it lands. The view
  renders each issue **in the order the API returns** — [[issues]]'s one time line, stores interleaved
  newest first: the frontend never re-sorts, and **shows no salience/priority ranking** (recurrence is the
  drain's judgment, per [[local-issues]], never an automatic order); reply counts appear as raw data, not a
  rank. **Concluded issues hide by default** — any non-open issue is archive (local `landed`, forge
  `closed`), not open work, and mixing them in only confuses review; a count chip reveals them on demand.
  The filter bar carries a **store
  filter** — the shared dropdown control ([[evals-view]]'s one filter grammar) whose options are DERIVED from
  the stores actually present in the data plus "all" — the bare word, never "all stores" (and never a
  hardcoded list: a new store's driver landing puts it in the menu for free), defaulting to
  "all" so the stores stay mixed; picking one narrows rows AND the counts to that store, and the control
  hides itself when only one store exists. An issue's ROW is one compact line that leads with the issue
  itself, never its plumbing: a **status DOT** (the status vocabulary as color — a boxed "open" on every row
  was noise), then the concern; the trailing edge carries the quiet meta — a compact reply-count pill and a
  **store mini-tag** (borderless, muted, and rendered only while stores are actually mixed — a single-store
  list carries no tags, mirroring the filter's own self-hiding). **The store is metadata, never identity: it
  never leads a row and never sits on a title** (the human called the leading boxed chip). The DETAIL opens
  with the concern ALONE as its title; everything else — status, store, ORIGINATOR + its liveness, node
  chips, permalink — is the meta strip under it, over the **markdown-rendered body and
  replies** — the same SpecBody renderer the spec
  panes use, so local-issue markdown and spec markdown read as one dialect (raw `##`/table pipes never show),
  and a forge issue's GitHub comments render as the SAME reply thread a local issue thread gets ([[issues]]
  maps them into `replies[]` — one thread type, one renderer). Store never changes the shape; the only
  store-specific affordances are metadata (a forge issue's permalink) — the
  thread itself reads and writes identically.
- **The originator's session is on the header.** A local thread's `by` is a session id, so the detail header
  renders it as a compact session chip with a liveness dot: **alive** when that session is listed on the
  board and not offline (its live status paints the dot in the board's four-hue `STATUS_COLOR`, [[state]]),
  **offline** otherwise. A live chip is the direct door back to the session board: click it and the dashboard
  opens `#/sessions/<id>`, selecting that session's tab. Offline originators stay as static identity chips.
  This is a thin read-time join of the id against the board sessions the page already holds — no new query,
  no second palette, and no explanatory reach phrase in the meta strip. A forge issue's `by` is a github
  login resolving to no session, so it stays a plain author label.
- **Node chips focus the graph.** An issue's node chips are clickable — a click routes to the graph page
  and **focuses that node**, so the page stays anchored to the graph it discusses.
- **Issue cards enter this page, never the forge.** Every compact issue card rendered outside the Issues
  page itself — the focus panel and the node-info Issues tab included — is the SAME `IssueCard` component
  over the unified Issue shape. Store changes only the muted tag text; local and forge issues get identical
  card chrome, identical truncation, and the same click target: `#/issues/<issue-id>`, which opens this
  page and selects that issue in its own detail pane. A forge permalink remains only a detail-meta affordance
  after selection, not the card's primary route. Long local ids, titles, or bodies must clamp inside the
  card and never widen the right sidebar or create a bottom scrollbar.
- **A human writes from here — to the issue's OWN store, from a composer that is ALWAYS on screen.** EVERY
  issue's detail carries a **reply composer**, and it is **DOCKED at the detail pane's foot** — the thread
  region scrolls behind it, so replying to a long thread never needs a scroll to its bottom (the same
  docked-bar shape as the eval rail's composer and the console's ❯ box, one write-affordance geometry across
  the review surfaces). The composer is the console-❯-box SHAPE: a **single collapsed line while idle** that
  **auto-grows with the draft** (the shared `textarea.js` fitTextarea — one grow routine for the console's
  boxes and the thread composers, capped so it never eats the pane) and reveals its actions row (hint + Send,
  the ⏱ where a clip supplies one, plus any host lifecycle action such as Close issue) while **engaged** —
  focused, carrying a draft or staged frames, showing a send error (an error must never collapse out of view),
  or carrying a lifecycle action that must stay visible. It is **keyed to the selected issue**, so
  a half-typed draft dies with its selection instead of leaking onto another issue's thread. The POST goes
  to the one store-routed reply verb ([[issues]]'s
  `replyIssue`, author `'human'`) — a local issue's reply git-commits to the trunk store, a forge issue's
  reply posts a REAL GitHub comment through the driver — then reloads so the post shows where it landed
  (the forge case shows the server's read-back, and a failed forge write surfaces in the composer, never
  a silent swallow). The filter bar carries a **New** affordance that opens a fresh LOCAL issue —
  a one-line concern and an optional body, nothing else: a `[[node]]` link written in the text IS the
  node link (the store infers the thread's `nodes:` from them, [[local-issues]]), so the form carries
  **no separate node-ids field** to re-type what the prose already says. New threads open local;
  promotion moves one to the forge. The dashboard adds no store of its own. A `@session`/`@new` in the text
  **dispatches** ([[mentions]]) exactly as a CLI post would, whatever the store — a human summons an
  agent from any thread, and that mention IS the "assign to an agent" verb; the returned one-line
  dispatch summary is echoed briefly. Both composers carry the SAME `@session` / `[[node]]`
  **autocomplete dropdown** the console's inputs use ([[mentions]]'s shared menu — one implementation,
  never a page-local fork): typing `@` lists the live sessions, `[[` lists the nodes (the thread's own
  node leading), a pick inserts the token, and Esc closes the menu without leaving the page. **New opens as a
  centered pop-out over the page, not as an inline row in the list column**: the left column stays a slim
  picker, the modal carries the same two text surfaces (concern + optional body), a single compact store
  picker (local plus the configured forge issue stores such as github/gitlab), its own close affordance, and
  Esc/backdrop close only that layer. The picker selects where the new issue is opened: local writes the
  git-native local store, while a forge choice creates the real forge issue through the same issue port and
  writes a `Spec:` marker from any `[[node]]` links so the tracer links it back on read. The modal's
  `@`/`[[` autocomplete opens above the body box, as an overlay, so it never becomes inserted into or clipped
  by the pop-out; it is positioned outside the modal, above the pop-out itself. A grammar
  that dispatches workers earns discoverability — a bare hint line proved not enough (the human typed
  `@` and got nothing).
  The reply list and reply composer are ONE shared component (`Thread.jsx`), delivery-agnostic
  (`onSend(text, evidence)`): the issue detail replies to its thread — both stores, the server routing the
  delivery — and the eval detail on the Evals page ([[event-detail]]) renders the SAME thread UI —
  autocomplete included — over its lazily-bound eval remark thread; one thread UI, every home, the store
  just another delivery behind the same seam. Following GitHub's issue page grammar, the **Close issue**
  affordance lives in the composer action row beside Send at the end of the thread, never in the
  title's top-right chrome and never as a separate row: closing is a lifecycle action on the conversation, not a way to dismiss the
  detail pane. Every non-concluded issue, local or remote, gets the same affordance there; the click goes
  through ONE store-routed close verb, then the resident issue list reloads so the issue disappears under
  the default concluded-hidden filter. The frontend does not branch on store beyond rendering metadata;
  local close marks the local thread landed, and remote close asks the forge driver to close its issue.
  **Promote** is the only extra local action in this row: an open local thread can move to the forge through
  the [[issues]] verb verbatim — the real forge issue first, then the local thread closes with the
  permalink. Sign / accept / reject are not product verbs; the dashboard should not offer them and the CLI
  should not keep parallel local lifecycle verbs for them. A refused write surfaces its server message in
  the row, never swallowed. A reply that is a
  REMARK renders its resolve/retract affordance here too — the shared thread UI's remark verbs
  ([[remark-substrate]] LAW L), the same rows the eval rail gets. A reply
  is TIME-ANCHORED by a prose convention (same
  philosophy as `Spec:`/`[[node]]`): a body whose first line reads `▶m:ss · <step>` IS anchored to a video
  moment — `Thread` linkifies it (click = seek, when the home supplies the clip) and, over a clip, the
  composer grows a ⏱ affordance that stamps the current frame; a circled frame — or ANY attached blob, a
  video clip included — rides the body as a `![…](/api/yatsu/blob/<hash>)` link whose hash the send derives
  as the thread's typed `evidence[]` (the frame-blob write is [[event-detail]]'s; a clip enters the cache
  via `spex blob put`, [[blob-put]]). Each linked blob renders through the ONE shared evidence renderer
  ([[event-detail]]'s `Evidence.jsx`): the blob's kind is resolved from the Content-Type the blob route
  already serves — the server's byte sniff is the single kind authority, so the thread never grows its own
  magic-number table and a link's label stays free prose — and a video PLAYS as a real `<video>` inline in
  the thread, an image shows (click-to-enlarge), a pruned blob is the honest miss sentinel, identical to
  how the same hash renders on the Evals detail or the node eval tab. The reply stays plain
  `{ by, at, body }` — no schema grows, no typed evidence entries, and a raw reader still
  sees the `▶m:ss` line.
- **Honors the switch.** When the issues workflow is OFF (`enabled: false`, [[local-issues]]'s toggle), the
  view shows a muted "off" state instead of the list — the dashboard reflects the one source of truth,
  never forks it.
