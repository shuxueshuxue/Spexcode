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
      reply composer. A forge selection instead carries its permalink and a read-only note. No page errors.
  - name: panel-skeleton
    tags: [frontend-e2e]
    code: spec-dashboard/src/IssuesView.jsx
    description: >-
      On the running issues page, read the master-detail shell: the grid split, which container scrolls,
      the sticky group heads. Then drive the keys — j repeatedly from the top so the selection crosses
      from the evals group into the issue group, k back up — and finally type 'j' inside the New-form
      input.
    expected: >-
      The page is a two-column grid: the LEFT column scrolls (both group heads sticky within it), the
      RIGHT detail pane scrolls independently, the page itself never scrolls. j/k move ONE visible
      selection across BOTH groups (evals rows first, then issue rows) and the detail pane follows the
      selection immediately — selection IS detail, nothing expands inside the list. Deep j keeps the
      selected row inside the left column's viewport. A key typed into an input/textarea reaches the
      input and never moves the selection. No page errors.
---

# measuring issues-view

YATU through the REAL running dashboard, never the code: a backend seeded with local + forge issues, the
worktree dashboard pointed at it, and a headless Chromium that opens #/forum and reads the live DOM
(`.fv-master`, `.fv-row`, `.fv-store`, `.fvd`, `.doc-body`) + screenshots it. The loss is the gap between
that reading and the spec: master-detail with evals leading, one merged store-tagged list in API order,
markdown-rendered detail, local-writable / forge-link-out. (This reading style is what caught the `t(...)`
i18n call-convention crash a build could not.)
