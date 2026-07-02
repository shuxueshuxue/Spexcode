---
title: issues-view
status: active
hue: 200
desc: The dashboard's ONE issues page — a second button beside New Session opens the merged Issue list ([[issues]]): local forum threads and forge issues mixed, store-tagged, rendered verbatim from /api/issues; node chips focus the graph; a human replies / opens a local thread in place, forge items link out.
code:
  - spec-dashboard/src/IssuesView.jsx
  - spec-dashboard/src/FeedSection.jsx
---

# issues-view

## raw source

Issues are one object over every store ([[issues]]), and a human wants **one place** to read them — an
agent's local taste proposal and a GitHub issue on the same node belong on the same page, not on two
surfaces the user must correlate. So the dashboard grows a second top button beside New Session that opens
the **issues page**. The dashboard stays a **thin window** over the CLI's truth, never a second source —
it renders what `/api/issues` returns and computes nothing, and every write goes through the SAME
reply/propose the CLI uses, committed straight to the trunk.

## expanded spec

- **Entries — the session board is the MAIN path.** The [[session-console]] top row ([[term-input]]'s
  `si-toprow`) carries an **Issues** pill beside `＋ New Session`, and the same console owns **⌥+F** — the
  twin of ⌥+N — snapping straight to the issues page (a third `active` mode alongside `new` and a
  session). That console-side entry is the primary one: a user reaches the forum from the session board,
  not by first hunting a node on the graph. The board's bare **`f` key** ([[keyboard-nav]]'s declarative
  keymap table, rebindable) exists as the secondary direct jump. All entries land on the ONE page —
  reusing the console overlay keeps it one surface, never a new route.
- **The panel is two pinned regions — importance by position and area, never tabs.** The page's target
  shape: an **evals region on top** (the [[evals-feed]] section — evals outrank threads, so they get the
  prime position) and the **threads region below** (this node's merged list). The layout iron rule: the
  outer container never scrolls; each region scrolls internally; and the bottom region is **always
  pinned** — at minimum it folds to a one-line summary bar with counts, it never disappears. Each region
  is one **FeedSection** instance with a container-owned **density prop** (`bar ⇄ region ⇄ page`): the
  SAME instance across densities, so scroll/focus/filter state survives a density change; `page` pushes
  one level onto the console's esc-stack. Keys: **Tab** jumps the panel focus between the two regions
  (shown on the section head); **j/k** walk the FOCUSED region's rows, **Enter** opens (an eval → the
  [[annotator]], a thread → its in-place expansion). Both regions are live: [[evals-feed]] mounts above
  the threads and takes the panel's `focused` prop; its row-nav under that focus is its own contract,
  the threads' rows are this node's. The section contents are their own nodes (children of this one,
  owned by the video-verification line); this node owns the panel skeleton — the regions, densities,
  pinning, and the Tab/j/k/Enter routing.
- **One merged list, store-tagged.** The view fetches `GET /api/issues` (`{ enabled, issues }`) — the
  merged read over every store — and renders each issue **in the order the API returns**: the frontend
  never re-sorts, and **shows no salience/priority ranking** (recurrence is the drain's judgment, per
  [[proposals]], never an automatic order); signer and reply counts appear as raw data, not a rank.
  **Concluded issues hide by default** — closed / rejected / landed are the archive, not the open work,
  and mixing them in only confuses review; a count chip reveals them on demand (open and accepted stay:
  accepted is approved-but-not-landed, still live). An
  issue shows its **store** (a `local` / host chip — the one visible trace of where it lives), concern,
  author, status, and its linked-node **chips**. Store never changes the
  shape, only two affordances: a **local** issue expands in place to its body + signed replies and takes a
  reply; a **forge** issue carries its permalink and is discussed on the forge — read here, written there.
- **Node chips focus the graph.** An issue's node chips are clickable — a click closes the console and
  **focuses that node** on the board, so the page stays anchored to the graph it discusses.
- **A human writes from here — to the local store.** An expanded local issue carries a **reply composer**
  (a textarea + Send); the top of the view carries a **New** affordance that opens a fresh local issue
  (a one-line concern, optional `[[node]]` links, an optional body). Both POST to
  `/api/issues` ([[proposals]]'s `forumReply`/`forumPost`, author `'human'`) — the SAME reply/propose the
  CLI uses, committed straight to the trunk — then reload so the new post shows. The write is a thin
  wrapper: the dashboard adds no store of its own, and it never writes to a forge ([[issues]]: v1 writes
  are local-only). A `@session` in the text **dispatches** ([[mentions]]) exactly as a CLI post would — a
  human summons an agent from the issues page — and the returned one-line dispatch summary is echoed
  briefly. A plain textarea with a `@session · [[node]]` hint is enough; autocomplete is optional.
- **Honors the switch.** When the forum workflow is OFF (`enabled: false`, [[proposals]]'s toggle), the
  view shows a muted "off" state instead of the list — the dashboard reflects the one source of truth,
  never forks it.
