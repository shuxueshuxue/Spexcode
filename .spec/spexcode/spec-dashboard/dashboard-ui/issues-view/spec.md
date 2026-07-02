---
title: issues-view
status: active
hue: 200
desc: The dashboard's ONE issues page — the Forum route (#/forum, [[side-nav]]) as a MASTER-DETAIL — a left list (evals leading, merged issues below) and a full-height detail pane the selection drives; markdown-rendered bodies and threads for both stores, node chips focus the graph, the detail's reply composer routes by store (forum commit or real forge comment).
code:
  - spec-dashboard/src/IssuesView.jsx
---

# issues-view

## raw source

Issues are one object over every store ([[issues]]), and a human wants **one place** to read them — an
agent's local taste proposal and a GitHub issue on the same node belong on the same page, not on two
surfaces the user must correlate. So the dashboard carries ONE **Forum page** for them, a top-level page
of its own. The dashboard stays a **thin window** over the CLI's truth, never a second source —
it renders what `/api/issues` returns and computes nothing, and every write goes through the SAME
reply/propose the CLI uses, committed straight to the trunk.

## expanded spec

- **Entries — the forum is its OWN page.** The page lives at `#/forum` with its own [[side-nav]] rail
  entry — bookmarkable, reloadable, a peer of the graph and the session board. The keyboard doors are
  [[side-nav]]'s global ⌥ vocabulary — **⌥F / ⌥3** reach it from any page, the console included — plus
  the board's bare **`f` key** ([[keyboard-nav]]'s declarative keymap table, rebindable) as the direct
  jump from the graph. There is no console pill and no page-local shortcut anymore: one page, the shared
  doors. Esc never leaves the page ([[side-nav]]) — it stays with the page's own stack; going elsewhere
  is the rail, ⌥digit, or history.
- **The page is a MASTER-DETAIL — a full page deserves a full-height detail, never an expansion inside a
  box.** (The earlier pinned-two-region form was conceived for a height-starved overlay; on a routed
  full page it collapsed content into a small scrolling box — the human called it, and the form
  changed.) The **left column** is TWO BOUNDED regions — the [[evals-feed]] group leading (evals outrank
  issues: position expresses it) sizes to content but CAPS at ~half the column and scrolls itself; the
  merged issue group takes the rest and is **always on screen** — many evals can never bury it (the
  pinning law, applied to the list column where it belongs). Each group head is sticky within its own
  scroller and carries its own controls (the evals chips; New + the concluded-count chip). The
  **right pane** is the full-height DETAIL of the one selection — **selection IS detail** (email-style,
  no Enter, no in-place expansion): an issue renders its markdown body, an eval renders as the
  [[annotator]]. **j/k walk the whole left list across both groups** and the detail follows; a key typed
  into an input is never captured. The section contents are their own nodes (children of this one, owned
  by the video-verification line); this node owns the page shell — the split, the row grammar, the
  selection, and the j/k routing.
- **One merged list, store-tagged — RESIDENT, never cold-fetched.** The list is app-held state beside the
  board (one data path): the page renders instantly from it on every visit; freshness inherits the
  board's own pattern — the push/change signal triggers a throttled refetch, the 15s cold lane backstops
  (forge-cache updates arrive nowhere else), and `GET /api/issues` answers **304 via ETag** so a no-change
  refetch costs headers only. A write forces the refetch so it shows up where it lands. The view renders
  each issue **in the order the API returns**: the frontend
  never re-sorts, and **shows no salience/priority ranking** (recurrence is the drain's judgment, per
  [[proposals]], never an automatic order); signer and reply counts appear as raw data, not a rank.
  **Concluded issues hide by default** — closed / rejected / landed are the archive, not the open work,
  and mixing them in only confuses review; a count chip reveals them on demand (open and accepted stay:
  accepted is approved-but-not-landed, still live). An
  issue's ROW is one compact line — store chip, concern, status, reply count; its DETAIL carries the full
  header (status, author, signer count, node chips, permalink) over the **markdown-rendered body and
  replies** — the same SpecBody renderer the spec panes use, so forum markdown and spec markdown read as
  one dialect (raw `##`/table pipes never show), and a forge issue's GitHub comments render as the SAME
  reply thread a forum thread gets ([[issues]] maps them into `replies[]` — one thread type, one
  renderer). Store never changes the shape; the only store-specific affordances are metadata (a local
  issue's signer count, a forge issue's permalink) — the thread itself reads and writes identically.
- **Node chips focus the graph.** An issue's node chips are clickable — a click routes to the graph page
  and **focuses that node**, so the page stays anchored to the graph it discusses.
- **A human writes from here — to the issue's OWN store.** EVERY issue's detail carries a **reply
  composer** (a textarea + Send): the POST goes to the one store-routed reply verb ([[issues]]'s
  `replyIssue`, author `'human'`) — a local issue's reply git-commits to the trunk forum, a forge issue's
  reply posts a REAL GitHub comment through the driver — then reloads so the post shows where it landed
  (the forge case shows the server's read-back, and a failed forge write surfaces in the composer, never
  a silent swallow). The issue group's head carries a **New** affordance that opens a fresh LOCAL issue
  (a one-line concern, optional `[[node]]` links, an optional body — new threads open local; promotion
  moves one to the forge). The dashboard adds no store of its own. A `@session`/`@new` in the text
  **dispatches** ([[mentions]]) exactly as a CLI post would, whatever the store — a human summons an
  agent from any thread, and that mention IS the "assign to an agent" verb; the returned one-line
  dispatch summary is echoed briefly. A plain textarea with a `@session · [[node]]` hint is enough;
  autocomplete is optional.
- **Honors the switch.** When the forum workflow is OFF (`enabled: false`, [[proposals]]'s toggle), the
  view shows a muted "off" state instead of the list — the dashboard reflects the one source of truth,
  never forks it.
