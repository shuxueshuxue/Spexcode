---
title: status-bar
status: active
hue: 210
desc: The window's bottom row and a registry behind it — items are declared data, not widgets someone positions.
code:
  - spec-dashboard/src/StatusBar.jsx
related:
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/specMeta.js
  - spec-dashboard/src/GraphView.jsx
  - spec-dashboard/src/Root.jsx
  - spec-dashboard/src/GraphStats.jsx
  - spec-dashboard/src/PublicGraphAbout.jsx
  - spec-dashboard/src/styles.css
---
# status-bar

A strip along the bottom of the **whole window**, and — the part that matters — a **registry** rather than a
place to hang things. It is one unshrinking flow row after the shell's rail, optional dock, and content row;
rail and dock end at the row's top edge, so the bar crosses the full viewport without covering content. The
project identity stays at the far left of that global line, where the human's requested global feeling is
visible even when the dock is folded or absent.

**What it replaced.** Every persistent readout used to be its own absolutely-positioned block: the project
HUD in one corner, the tally strip in another, the public-graph disclosure in a third, each with its own
offsets and its own rung on the z-index ladder. Worse, they had to know about each other — the session
window capped its height at `calc(100vh - 112px)` because a tally strip happened to sit underneath it, a
number that encoded one widget's geometry inside an unrelated component. That is the coupling a registry
removes: a contributor declares an item and never learns where the bar is, and the bar reserves its own
height once, for everyone.

**The model.** Four independent implementations agree on it, so it is taken whole rather than invented:

- **Two ordered arrays, never one flow.** The left group carries workspace state; the right carries the
  focused document's. The right group renders **outward-in**, so an appended item lands at the outer edge
  and a higher priority sits nearer the centre without the contributor computing a position.
- **An item is data plus a lifetime, never a DOM node handed in.** It declares `id`, `side`, `priority`,
  a `text` or `node`, an optional `tooltip`/`onClick`, and a `kind`. **`kind` is the only colour a
  contributor may spend** — there is no raw-hex field, because a pinned hex cannot re-theme, which is
  exactly the mistake the node status dots made and the one thing a new item must not be able to repeat.
- **Order is a number with a deterministic tiebreak.** Higher priority moves an item left within its group;
  ties break on a hash of the id, never on arrival, so re-registering in a different order cannot shuffle
  the bar. `±Infinity` is available for an item that must pin to an end.
- **Visibility is a set the user owns**, keyed by id and stored outside the item. Right-click hides;
  a single `+N` control at the right end restores. The contributor is never asked and never notified —
  hiding a readout is not a negotiation with whoever supplied it.

Registration is a hook, so an item's lifetime is its contributor's lifetime and updating it means
re-rendering — there is no imperative handle to keep in sync with React's own. Outside a provider the hook
is inert, which is what lets the phone face and the sealed public build skip a bar they do not draw.

**It is a row in layout, not an overlay.** The shell's top-level flex has one app row (rail, optional dock,
and content) followed by this strip. Within the app row the view/context row takes the remaining height;
the strip takes one unshrinking `--line-status` row of its own. No `position: fixed|absolute`, bottom offset,
or page-owned padding reserves its space. The consequence is observable in every view, especially the
terminal: xterm's last fitted row ends above the status bar and remains fully visible rather than painting
underneath it.

The vertical rail-or-dock/content seam and the horizontal full-width status seam are each a one-pixel
`--line` border. The rail and dock borders terminate at the status seam, making the lower-left junction a
clean T rather than the former L; the status line runs flush from the left viewport edge to the right.

**Human re-judgment.** The earlier direction was: "底下那个 status line 还是按之前那样,做成一整条全屏宽度的横线…"
and "左边那个图标以及项目管理按钮放那边也更合适,否则…没有一种全局感。" This revision follows that
second judgment: global feeling outranks column-local feeling. The change is geometry only; the identity,
ledger, freshness marks, width budget, and terminal row contract remain unchanged.

**Its own geometry is a token, not a literal.** The strip is `--line-status`, joining the existing
`--line-input` / `--line-badge` / `--line-session-row` family of named fixed line boxes. This is not
tidiness: the shared-typography guard rejects a hardcoded `line-height`, and it was right to — the height
of the bar is a shared geometry that other components will eventually measure against, and a literal is
exactly how the 112px coupling started.

**What is registered today.** On the left, one compact project identity button (small project mark plus
project name) and — while the graph is the document — its help key. The identity button owns the complete
catalog-backed project switcher formerly opened from the rail: online projects remain same-tab links,
offline projects remain visible and inert, and the global Projects row opens `/projects`; a denied catalog
makes the same identity control the management-login door without exposing rows. The rail has no project
chip or second switcher. It stays at the status row's left edge rather than moving into the sidebar because
the dock may fold or be absent on bare boards: this placement keeps the icon, name, and switch action
complete and stationary on every desktop route while remaining immediately adjacent to the sidebar. When
opened, its catalog menu is anchored to that button's own slot, opening upward from the button's top edge,
sharing its left edge, and shrinking to the viewport when the window is narrow.
On the right, one shell-owned BOARD LEDGER, grouped by destination: the spec-node total with
its four-state breakdown and drift-node count; all five eval scenario states (fresh pass/fail, stale
pass/fail, unmeasured); the deduped open-issue total; and live sessions grouped by the configured
`sessions.launchers` names. Each launcher group leads with the harness mark from the shared icon vocabulary
and renders a compact `running/needs-you/other` slash tally using the existing green/yellow/muted status
tokens. Only launchers with at least one session render. Records whose launcher is null, hidden, or no longer
configured are counted in one `other` group instead of being dropped. Every group opens the sessions console, and its tooltip names the launcher and all three tally
meanings. At compact desktop widths the launcher list hides as one unit and a single clickable aggregate
KDA badge takes its place, so the slash tally can never be clipped between digits. Named launcher profiles
that share a harness mark carry a small profile-initial badge (for example `R` and `C`) so icon-only mode
still distinguishes them. When any session needs the human, the sessions ledger item also carries the
existing `sb-warning` yellow semantic token. Beside them ride the document's own facts: the routed file's path when
[[file-view]] is the document, the session console's unread-resource signal, the public-graph disclosure.

**The tallies are the workspace's, and the shell registers them.** They are true of the window on every
route, so they cannot belong to a view — hanging them off the graph is exactly what emptied this bar the
moment the graph stopped being where a reader lands, leaving one item on a strip that is supposed to answer
how the work is doing. They ride the right group because that is where the graph tally already sat and
because the left group is the identity strip; the region law that assigns them an owner is
[[workspace-shell]]'s, and the owner is the frame.

The ledger never stands down and no view registers a substitute. On graph addresses its category buttons
gain [[graph-stats]]'s focus-walk: repeated clicks cycle the counted node ring and wrap. Off the graph,
issue/eval categories open their boards and node categories enter the graph on a matching node. Thus every
number remains a door without creating a second owner or tying ownership to a mounted view's lifetime.

At every viewport the right group uses the available inline space without a hard viewport fraction or clipping
overflow. Existing board, eval, and issue ledgers remain complete and actionable; launcher groups are
non-overlapping fixed-content units, and compact widths swap the whole launcher list for one aggregate
badge before any slash digit can be cut. Density comes from one occurrence of each fact and compact
glyph/count pairs, not truncating the ledger. Fresh and stale score states use different icon geometry from the shared
icon system: solid outer rings are current; dashed outer rings are stale; the inner check/cross preserves
the last verdict.

Last-good tallies remain useful during a backend outage, but they are not current truth. While the shared
transport is offline, every numeric workspace tally visibly carries a compact `~` stale marker (with the
translated `stale` word retained as its accessible name and tooltip) and muted treatment; the global shell
banner names the outage and owns retry. The marker occupies the status item's existing 5px trailing padding and
adds no layout width or overlap with the final digit, keeping the complete right group within the 480px bound
even while all last-good digits remain rendered and actionable. A successful transport response removes the
marker without replacing the numbers with invented zeroes.

**Restraint is the resting state.** A tally is muted text plus the board's own status marks; it spends a
`kind` colour only where the number is asking for something — a failing eval, a session waiting on a human.
A count that is merely large stays quiet. Per-chip items would give the user finer hiding, and the registry
already supports it; that is an unclaimed improvement, not a hidden limitation.

**A document contributing a fact about itself is the registry working as designed.** A file document's path
belongs to the bar for the same reason the project name does — it is persistently true of what the window
is showing — and the alternative was a title strip of its own, which is a chrome band [[ui-state-model]]
does not allot. The bar is where a persistent readout goes precisely so that no surface has to grow one.

Session lifecycle attention reuses the same transient-notice provider as every other acknowledged action. A transition
into `asking` emits one clickable notice that opens that session document; no session-specific notification channel exists.

Board tally actions use the shared [[icon-system]] registry for their semantic marks: drift uses the
`triangle-alert` glyph and issue totals use the official `issue-opened` glyph. Statusbar markup does not
introduce Unicode warning/diamond stand-ins or a second local icon vocabulary; the tally's count and
accessible label remain unchanged.
