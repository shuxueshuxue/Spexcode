---
scenarios:
  - name: renders-merged-issues
    tags: [frontend-e2e]
    code: spec-dashboard/src/IssuesPage.jsx
    description: >-
      Run the dashboard against a backend whose issues span both stores (a local thread with a signer +
      reply, forge issues). Open #/issues and read the rendered DOM: the issue group's rows, then select
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
    code: [spec-dashboard/src/IssuesPage.jsx, spec-dashboard/src/mentions.jsx]
    description: >-
      On the running issues page, select a LOCAL issue and type into its reply composer, then open the
      New form and type into its body textarea. In each: type `@`, read the dropdown, pick a row with
      ↓/Enter and read the inserted text; clear, type `[[` (and a partial id), pick, read the insertion;
      press Esc with a menu open and read the hash; type plain prose and look for any menu. Then visit
      the session console and re-check its `@`/`[[` menus still open (the shared-module regression).
    expected: >-
      Both composers carry the console's OWN mention dropdowns ([[mentions]] — one shared menu, not a
      fork): `@` lists the live sessions plus `@new` and a pick inserts `@<id> ` (trailing space); `[[`
      lists the spec nodes (a partial query filters) and a pick inserts `[[<id>]] `. The reply
      composer's menu opens UPWARD (visible above the docked textarea), the New form's downward. Esc
      closes the menu, keeps the draft, and stays on #/issues. Plain text never opens a menu. The
      console's `@`/`[[` menus are unchanged. No page errors.
  - name: issue-reply-video-plays
    tags: [frontend-e2e]
    code: [spec-dashboard/src/Thread.jsx, spec-dashboard/src/Evidence.jsx]
    description: >-
      Cache a real clip with `spex blob put <clip.webm>` (no reading filed), post a LOCAL issue reply
      whose body carries a `![video](/api/yatsu/blob/<hash>)` link (same hash as the reply's evidence),
      plus a reply with an image link and one with a hash whose blob is absent. Open #/issues, select the
      thread, and read each rendered reply's real DOM: the media element's tag, its readyState/currentTime
      after play(), and whether raw markdown link text shows in the prose.
    expected: >-
      The video-linked reply renders a real playing HTML5 `<video class="eval-video" controls>` sourced
      from /api/yatsu/blob/<hash> — frames decode (readyState ≥ HAVE_CURRENT_DATA, currentTime advances
      after play()), never a broken `<img>` and never raw markdown in the prose. The image link still
      renders as an image (click-to-enlarge), and the absent blob renders the honest miss sentinel. The
      element is the SAME shared-renderer output the eval tab and eval detail produce for the same hash —
      one evidence renderer, every home.
  - name: panel-skeleton
    tags: [frontend-e2e]
    code: spec-dashboard/src/IssuesPage.jsx
    description: >-
      On the running issues page (#/issues), read the master-detail shell: the grid split and the LIST
      COLUMN'S MEASURED WIDTH, the left box (NO tab switcher — the Issues page is its own top-level route
      now), which container scrolls, the sticky filter bar. Click the fold toggle and re-measure the
      columns; unfold. Drive j/k in the issue list; select a row and read the detail pane; finally type
      'j' inside the New-form input.
    expected: >-
      The page is a two-column grid whose LEFT column is SLIM (compact one-line rows, at most ~280px —
      the detail is the protagonist): ONE box — the merged issue list under its own
      sticky filter bar (the store filter + New + the concluded chip, with the open/total meta at its
      END), NO Evals|Threads tab switcher present; its list gets the full column height, scrolling
      itself; the RIGHT detail pane scrolls independently, the page itself never scrolls. The fold
      toggle collapses the list to a thin strip (the detail takes essentially the full width) and the
      strip unfolds it with filters and selection intact. The list
      renders INSTANTLY from app-resident issues (no per-mount fetch). j/k move ONE visible selection in
      the issue list and the detail pane follows immediately — selection IS detail, nothing expands
      inside the list. Deep j keeps the selected row inside the left column's viewport. A key typed into
      an input/textarea reaches the input and never moves the selection. No page errors.
  - name: signed-badge-only-when-nonzero
    tags: [frontend-e2e]
    code: spec-dashboard/src/IssuesPage.jsx
    description: >-
      Run the dashboard against a backend with two LOCAL issues: one with ZERO signers, one with ≥1
      signers. Open #/issues, select each, and read the detail meta strip (`.fvd-meta`) — look for the
      signed badge (`.fv-count` reading "+N signed").
    expected: >-
      The zero-signer issue's detail shows NO signed badge at all (a "+0 signed" is noise — suppressed,
      mirroring the CLI's own nonzero guard). The signed issue shows "+N signed" with the true count. The
      sign feature is otherwise unchanged. No page errors.
  - name: originator-liveness-shown
    tags: [frontend-e2e]
    code: spec-dashboard/src/Thread.jsx
    description: >-
      Run the dashboard against a backend whose board lists live sessions. Seed one LOCAL issue whose `by`
      is an ONLINE session id and one whose `by` is an id absent from the board. Open #/issues, select
      each, and read the detail header's originator pill (`.fv-originator`): its alive/offline class, the
      dot's computed background colour, and the reach phrase.
    expected: >-
      Each local issue's header shows the originator id with a liveness dot and reach phrase. The ONLINE
      originator reads `alive` (a status-hued dot from the board's `STATUS_COLOR`, "alive · replies reach
      it live") — an un-@'d reply courtesy-delivers to it. The absent originator reads `offline` (muted
      dot, "offline · replies skip it"). A forge issue's github-login `by` resolves to no session and
      stays a plain author label. No second palette, no page errors.
---

# measuring issues-view

YATU through the REAL running dashboard, never the code: a backend seeded with local + forge issues, the
worktree dashboard pointed at it, and a headless Chromium that opens #/issues and reads the live DOM
(`.fv-master`, `.fv-row`, `.fv-store`, `.fvd`, `.doc-body`) + screenshots it. The loss is the gap between
that reading and the spec: a master-detail Issues page (its own top-level route, no in-page switcher),
one merged store-tagged list in API order, markdown-rendered detail, one thread surface and one composer
over both stores. (This reading style is
what caught the `t(...)` i18n call-convention crash a build could not.)
