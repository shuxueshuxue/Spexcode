---
title: forum-view
status: active
hue: 200
desc: The dashboard's info page over the git-native forum — a second button beside New Session opens it; threads (proposals + notes) render verbatim from /api/forum, with node chips that focus the graph, and a human can reply / open a new thread in place. A thin window over the CLI's truth, now writable.
code:
  - spec-dashboard/src/ForumView.jsx
---

# forum-view

## raw source

The forum ([[proposals]]) is the git-native discussion layer over the graph, and a human wants a place to
*read* it — and to *write* into it — not just the CLI drain view. So the dashboard grows a second top button
beside New Session that opens an **info page**: a forum. But the dashboard is a **thin window** over the
CLI's truth, never a second source — it renders what `/api/forum` returns and computes nothing, and every
write goes through the SAME reply/propose the CLI uses, committed straight to the trunk.

## expanded spec

- **Entry: a second pill beside New Session.** The [[session-console]] top row ([[term-input]]'s `si-toprow`)
  held only `＋ New Session`; it now also carries a **Forum** pill. Both share that spot — one starts work,
  the other opens the forum info page in the same content pane (a third `active` mode alongside `new` and a
  session). Reusing the console overlay keeps it one surface, not a new route.
- **Thin, and now writable.** The view fetches `GET /api/forum` (`{ enabled, threads }`) and renders each thread
  **in the order the API returns** — the frontend never re-sorts, and **shows no salience/priority ranking**
  (recurrence is the drain's judgment, per [[proposals]], never an automatic order): signer and reply counts
  appear as raw data, not a rank. A thread shows its **kind** (proposal | note), concern, author, status, its
  linked-node **chips**, and expands in place to its body + signed replies.
- **Node chips focus the graph.** A thread's `[[node]]` chips are clickable — a click closes the console and
  **focuses that node** on the board, so the forum stays anchored to the graph it discusses.
- **A human writes from here.** An expanded thread carries a **reply composer** (a textarea + Send); the top
  of the view carries a **New** affordance that opens a fresh **proposal | note** (a kind toggle, a one-line
  concern, optional `[[node]]` links, an optional body). Both POST to `/api/forum` ([[proposals]]'s
  `forumReply`/`forumPost`, author `'human'`) — the SAME reply/propose the CLI uses, committed straight to the
  trunk — then reload the forum so the new post shows. The write is a thin wrapper: the dashboard adds no store
  of its own. A `@session` in the text **dispatches** ([[mentions]]) exactly as a CLI post would — a human
  summons an agent from the forum — and the returned one-line dispatch summary is echoed briefly. A plain
  textarea with a `@session · [[node]]` hint is enough; autocomplete is optional.
- **Honors the switch.** When the forum is OFF (`enabled: false`, [[proposals]]'s toggle), the view shows a
  muted "forum is off" state instead of threads — the dashboard reflects the one source of truth, never
  forks it.
