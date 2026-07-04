---
title: issues-view
status: active
hue: 200
desc: The dashboard's Issues page — a top-level route (#/issues, [[side-nav]]) peer to the graph, the session board, and the Evals page, as a MASTER-DETAIL — the merged issue list (local forum + forge, store-tagged) on the left, a full-height detail pane the selection drives on the right; markdown-rendered bodies and threads, node chips focus the graph, the reply composer routes by store (local-store commit or real forge comment).
code:
  - spec-dashboard/src/IssuesPage.jsx
  - spec-dashboard/src/Thread.jsx
---

# issues-view

## raw source

Issues are one object over every store ([[issues]]), and a human wants **one place** to read them — an
agent's local taste proposal and a GitHub issue on the same node belong on the same page, not on two
surfaces the user must correlate. So the dashboard carries ONE **issues page** for them, a top-level page
of its own — a peer of the graph, the session board, and the Evals page ([[evals-view]]), never a tab
folded inside another surface (the earlier `Evals | Threads` switcher was collapsed by the human's
directive: evals and issues are two top-level pages, not one page with an in-page switch). The dashboard
stays a **thin window** over the CLI's truth, never a second source — it renders what `/api/issues`
returns and computes nothing, and every write goes through the SAME reply/propose the CLI uses, committed
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
  **left column** is ONE box — the merged issue list under its own filter bar (the store filter + New + the
  concluded-count chip, with the **open/total meta at the END of the bar, never at its head**); the bar
  stays sticky over the full-height list, which scrolls itself. The [[side-nav]] rail names the page, so the
  column carries no title of its own. The **right pane** is the full-height DETAIL of the one selection —
  **selection IS detail** (email-style, no Enter, no in-place expansion): an issue renders its markdown
  body. **j/k walk the issue list** and the detail follows; a key typed into an input is never captured.
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
  drain's judgment, per [[proposals]], never an automatic order); signer and reply counts appear as raw
  data, not a rank. **Concluded issues hide by default** — closed / rejected / landed are the archive, not
  the open work, and mixing them in only confuses review; a count chip reveals them on demand (open and
  accepted stay: accepted is approved-but-not-landed, still live). The filter bar carries a **store
  filter** — a small dropdown whose options are DERIVED from the stores actually present in the data plus
  "all" (never a hardcoded list: a new store's driver landing puts it in the menu for free), defaulting to
  "all" so the stores stay mixed; picking one narrows rows AND the counts to that store, and the control
  hides itself when only one store exists. An issue's ROW is one compact line — store chip, concern, status,
  reply count; its DETAIL carries the full header (status, author, signer count, node chips, permalink) over
  the **markdown-rendered body and replies** — the same SpecBody renderer the spec panes use, so
  local-issue markdown and spec markdown read as one dialect (raw `##`/table pipes never show), and a forge
  issue's GitHub comments render as the SAME reply thread a local issue thread gets ([[issues]] maps them
  into `replies[]` — one thread type, one renderer). Store never changes the shape; the only store-specific
  affordances are metadata (a local issue's signer count, a forge issue's permalink) — the thread itself
  reads and writes identically.
- **Node chips focus the graph.** An issue's node chips are clickable — a click routes to the graph page
  and **focuses that node**, so the page stays anchored to the graph it discusses.
- **A human writes from here — to the issue's OWN store.** EVERY issue's detail carries a **reply
  composer** (a textarea + Send): the POST goes to the one store-routed reply verb ([[issues]]'s
  `replyIssue`, author `'human'`) — a local issue's reply git-commits to the trunk store, a forge issue's
  reply posts a REAL GitHub comment through the driver — then reloads so the post shows where it landed
  (the forge case shows the server's read-back, and a failed forge write surfaces in the composer, never
  a silent swallow). The filter bar carries a **New** affordance that opens a fresh LOCAL issue
  (a one-line concern, optional `[[node]]` links, an optional body — new threads open local; promotion
  moves one to the forge). The dashboard adds no store of its own. A `@session`/`@new` in the text
  **dispatches** ([[mentions]]) exactly as a CLI post would, whatever the store — a human summons an
  agent from any thread, and that mention IS the "assign to an agent" verb; the returned one-line
  dispatch summary is echoed briefly. Both composers carry the SAME `@session` / `[[node]]`
  **autocomplete dropdown** the console's inputs use ([[mentions]]'s shared menu — one implementation,
  never a page-local fork): typing `@` lists the live sessions, `[[` lists the nodes (the thread's own
  node leading), a pick inserts the token, and Esc closes the menu without leaving the page. A grammar
  that dispatches workers earns discoverability — a bare hint line proved not enough (the human typed
  `@` and got nothing).
  The reply list and reply composer are ONE shared component (`Thread.jsx`), delivery-agnostic
  (`onSend(text, evidence)`): the issue detail replies to its thread — both stores, the server routing the
  delivery — and the eval detail on the Evals page ([[event-detail]]) renders the SAME thread UI —
  autocomplete included — over its lazily-bound eval remark thread; one thread UI, every home, the store
  just another delivery behind the same seam. A reply is TIME-ANCHORED by a prose convention (same
  philosophy as `Spec:`/`[[node]]`): a body whose first line reads `▶m:ss · <step>` IS anchored to a video
  moment — `Thread` linkifies it (click = seek, when the home supplies the clip) and, over a clip, the
  composer grows a ⏱ affordance that stamps the current frame; a circled frame rides the body as an image
  link whose hash the send derives as the thread's typed `evidence[]` (the frame-blob write is
  [[event-detail]]'s). The reply stays plain `{ by, at, body }` — no schema grows, and a raw reader still
  sees the `▶m:ss` line.
- **Honors the switch.** When the issues workflow is OFF (`enabled: false`, [[proposals]]'s toggle), the
  view shows a muted "off" state instead of the list — the dashboard reflects the one source of truth,
  never forks it.
