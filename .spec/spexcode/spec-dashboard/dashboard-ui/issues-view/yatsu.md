---
scenarios:
  - name: renders-merged-issues
    tags: [frontend-e2e]
    code: spec-dashboard/src/IssuesView.jsx
    description: >-
      Run the dashboard against a backend whose issues span both stores (a local thread with a signer +
      reply, forge issues). Open #/forum and read the rendered DOM: the issue group's rows, then select
      the local thread and read the detail pane; check for raw markdown syntax in the detail.
    expected: >-
      The issue group renders the non-concluded rows in the API's order (no re-sort/rank): one compact
      line each — store chip, concern, status badge, reply count. Concluded issues (closed/rejected/
      landed) are hidden behind a count chip that reveals them. Selecting the local thread opens it in
      the RIGHT detail pane: full header (status, author, "+N signed", clickable node chips), the body
      and replies MARKDOWN-RENDERED (headings/tables/lists — no raw `##` or `|` pipes visible), and a
      reply composer. A forge selection renders the SAME way — its GitHub comments as the reply thread,
      its permalink in the header, and the SAME composer (no read-only note exists) — store never changes
      the thread's shape. No page errors.
  - name: composer-mention-autocomplete
    tags: [frontend-e2e]
    code: [spec-dashboard/src/IssuesView.jsx, spec-dashboard/src/mentions.jsx]
    description: >-
      On the running forum page, select a LOCAL issue and type into its reply composer, then open the
      New form and type into its body textarea. In each: type `@`, read the dropdown, pick a row with
      ↓/Enter and read the inserted text; clear, type `[[` (and a partial id), pick, read the insertion;
      press Esc with a menu open and read the hash; type plain prose and look for any menu. Then visit
      the session console and re-check its `@`/`[[` menus still open (the shared-module regression).
    expected: >-
      Both composers carry the console's OWN mention dropdowns ([[mentions]] — one shared menu, not a
      fork): `@` lists the live sessions plus `@new` and a pick inserts `@<id> ` (trailing space); `[[`
      lists the spec nodes (a partial query filters) and a pick inserts `[[<id>]] `. The reply
      composer's menu opens UPWARD (visible above the docked textarea), the New form's downward. Esc
      closes the menu, keeps the draft, and stays on #/forum. Plain text never opens a menu. The
      console's `@`/`[[` menus are unchanged. No page errors.
  - name: panel-skeleton
    tags: [frontend-e2e]
    code: spec-dashboard/src/IssuesView.jsx
    description: >-
      On the running issues page, read the master-detail shell: the grid split, the left box's tab
      switcher, which container scrolls, the sticky filter bar. Flip between the Evals and Threads tabs
      and read what each shows; drive j/k within a tab; select in one tab, flip to the other, and read
      the detail pane; finally type 'j' inside the New-form input.
    expected: >-
      The page is a two-column grid: the LEFT column is ONE box under a prominent Evals|Threads switcher
      (each tab button carries a small count) — the switcher is the title, the active tab's filter bar
      sits under it (the threads bar puts the open/total meta at its END) and its list gets the full
      column height, scrolling itself; the RIGHT detail pane scrolls independently, the page itself
      never scrolls. The list renders INSTANTLY from app-resident issues (no per-mount fetch). j/k move
      ONE visible selection within the ACTIVE tab and the detail pane follows immediately — selection IS
      detail, nothing expands inside the list; flipping tabs keeps the previous selection's detail until
      a pick in the new tab. Deep j keeps the selected row inside the left column's viewport. A key
      typed into an input/textarea reaches the input and never moves the selection. No page errors.
---

# measuring issues-view

YATU through the REAL running dashboard, never the code: a backend seeded with local + forge issues, the
worktree dashboard pointed at it, and a headless Chromium that opens #/forum and reads the live DOM
(`.fv-master`, `.fv-row`, `.fv-store`, `.fvd`, `.doc-body`) + screenshots it. The loss is the gap between
that reading and the spec: master-detail with evals leading, one merged store-tagged list in API order,
markdown-rendered detail, one thread surface and one composer over both stores. (This reading style is
what caught the `t(...)` i18n call-convention crash a build could not.)
