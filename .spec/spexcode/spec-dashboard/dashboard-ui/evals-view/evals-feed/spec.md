---
title: evals-feed
status: active
hue: 200
desc: The Evals page's feed — the project's current measured loss as a feed, the left list of the master-detail ([[evals-view]]). Latest reading per scenario, fresh AND stale mixed newest-first (freshness is never a filter — no stale control exists); one kind dropdown (video | image | all) as the only filter, the shared control the issues drain wears; title-only rows, media strictly lazy.
code:
  - spec-dashboard/src/EvalsFeed.jsx
related:
  - spec-eval/src/evaltab.ts
  - spec-cli/src/board.ts
  - spec-dashboard/src/App.jsx
---
# evals-feed

## raw source

The Evals page ([[evals-view]]) is where a human reads the project's current measured loss — the leading
review surface, a top-level page of its own (evals outrank issues, so they get the leading page and the
`f` / ⌥F doors). This feed is its left list, and its outer container never scrolls — the list scrolls
internally. A feed of every reading ever filed grows without bound; a feed of the project's *current* loss
does not. The unit of this feed is the **scenario, not the reading**: the eval engine already defines the latest
reading per scenario as the current score, so the feed is bounded by declared scenarios (structural,
slow-growing), never by measurement count. Review attends to what still counts.

## expanded spec

Default view: **latest reading per scenario, newest first — fresh and stale MIXED, always**. Freshness is
**never a filter**: a stale reading is real measured loss and stays in the time-ordered feed, its row carrying
the muted ✓/✗ that marks it stale (so it reads *as* stale without being removed) — hiding it was the bug that
let a just-filed screenshot vanish while newer work looked absent, and the stale-only toggle once offered on
top of the always-mixed default proved redundant, so the head carries **no stale control at all**. The ONE
filter control is the **evidence-kind dropdown** — exactly three options, **video | image | all** — rendered
by the SAME shared `FilterSelect` control the [[issues-view]] drain's store filter uses (one implementation,
one look, never two page-local forks). It defaults to `video`, falling back to `image` when no reading
*contains* a video and to `all` when neither media kind is present. The dropdown lives in this group's sticky
head, on its **control row** beside the shell's fold toggle — [[evals-view]] owns the fold *state* but hands
the anchored button in as `lead`, so the head wears the same control-row grammar as the issues drain and
nothing floats over the list — and the filter is this group's own state — [[evals-view]] owns the page shell
(split, selection, j/k), never this
group's filter. The head's chip row carries the [[live-session-filter]] "N live" toggle (this feed is that
feature's second surface: it narrows to readings whose filer session is alive, the same one-judgment join the
originator chip renders). One deliberate exception rides that ownership the RIGHT way round: a **deep-linked eval the
current filter would hide** ([[evals-view]]'s canonical `#/evals/<node>/<scenario>` address) is handed down
as a `mustShow` key, and the group widens **its own** dropdown to `all` so the address always renders its
eval — the page never reaches into the group's filter state, and an address naming no real eval changes
nothing. The widen is **one-shot per arrival**: once the target is visible the key clears, so a dropdown pick
that hides the *current selection* is the human's filter decision and always wins — the selection falls to
the first visible row instead of the filter snapping back.

**Kinds are honest — and a reading carries a SET of them.** Evidence is a LIST, so a reading's kinds are
every entry it holds: `video`/`image`/`transcript` (a legacy scalar blob with no recorded kind is an image —
every legacy capture was one), and **`note`** when it holds no blob at all (a verdict filed with prose only). A
**MIXED** reading (images + a video) belongs to **EVERY** media filter it contains — it shows under both the
`video` and `image` picks — and its row tag lists its media kinds, video-first (e.g. `vid·img`). A reading
never advertises media it lacks. But `note` and `transcript` are **data-level kinds only, never filter
options**: the dropdown stays video | image | all, so a transcript-only or blob-less reading surfaces under
`all` alone, and a blob-less row simply carries no media tag.

**Rows are title-only, always** — verdict mark · scenario · node · evidence-kind tag · relative time —
no media request of any kind in the list. Selecting a row opens it in the page's DETAIL pane as the
[[event-detail]] — media loads there, a `<video>` element exists only there. The group reports its visible
rows upward so the page's j/k walk the feed; history drills down per scenario
(the node's [[eval-tab]] scaffold), not in the list.

**One data path, one computation.** The board nodes arrive as a prop from the app's single board
poll + SSE subscription — the section fetches nothing of its own — and latest-per-scenario is
`scenarioStates`, the same computation behind the node badge, the focus panel, and the eval tab; the feed
never re-derives the current score its own way. At scale the board fold itself converges to the same
semantics — latest reading per scenario plus a history count, the full timeline served per node on
demand — one convergence shared by this feed, the node eval tab, and [[graph-lean]];
`clean --keep-latest` already aligns the evidence bytes with it.
