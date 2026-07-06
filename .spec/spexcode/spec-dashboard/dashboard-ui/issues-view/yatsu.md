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
      line each, LEADING with the issue itself — a status-colored dot, then the concern; the trailing
      edge carries only quiet meta (a compact reply-count pill, and a borderless muted store mini-tag
      present only because the stores are mixed). NO boxed store chip leads any row. Concluded issues
      (closed/rejected/landed) are hidden behind a count chip that reveals them. Selecting the local
      thread opens it in the RIGHT detail pane: the title is the concern ALONE (no store chip on the
      title); the meta strip under it carries status, the store tag, author, "+N signed", clickable node
      chips; the body and replies MARKDOWN-RENDERED (headings/tables/lists — no raw `##` or `|` pipes
      visible), and a reply composer. A forge selection renders the SAME way — its GitHub comments as
      the reply thread, its permalink in the meta strip, and the SAME composer (no read-only note
      exists) — store never changes the thread's shape. No page errors.
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
      composer's menu opens UPWARD (visible above the docked textarea), and the New form's menu also opens
      UPWARD outside the New pop-out itself, never inserted into or clipped by the modal body and never
      covering the store/concern controls. Esc closes the menu, keeps the draft, and stays on #/issues. Plain text never opens a menu. The
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
  - name: composer-docked-autogrow
    tags: [frontend-e2e]
    code: [spec-dashboard/src/IssuesPage.jsx, spec-dashboard/src/Thread.jsx, spec-dashboard/src/textarea.js]
    description: >-
      On the running issues page, select an issue whose thread is LONG (body + replies overflow the
      detail pane). WITHOUT scrolling, read the reply composer's geometry (getBoundingClientRect on
      `.fvd-compose` and its textarea) against the viewport; read the collapsed textarea's height and
      whether the actions row (`.fv-actions`) is present. Focus the textarea and re-read; type several
      lines and read the height after each; clear and blur and re-read. Then scroll the thread region
      and read whether the composer moved. Repeat the collapsed/engaged reading on an eval detail's
      rail composer (#/evals).
    expected: >-
      The composer is DOCKED at the detail pane's foot — visible in the viewport immediately on
      selection, no scrolling needed even on a long thread; the thread scrolls in its own region
      (`.fvd-scroll`) behind it and the composer never moves. Idle, it is COLLAPSED: a single-line
      textarea. For a non-concluded issue, the lifecycle action pins the action row visible even while
      idle: disabled Send and Close issue sit beside each other in that same row; focusing/typing keeps
      the row and typing grows the textarea line by line (capped — it never eats the pane). For a home
      with no lifecycle action, such as the eval detail rail composer, idle still has no actions row and
      focus reveals hint + Send. An emptied, blurred composer collapses back to one line. Switching to
      another issue clears the draft (keyed to the selection). One shared composer, every home. No page
      errors.
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
  - name: new-form-node-links
    tags: [frontend-e2e]
    code: spec-dashboard/src/IssuesPage.jsx
    description: >-
      On the running issues page, open the New form and count its text surfaces; then post an issue whose
      concern is plain prose and whose body links a real node with `[[<id>]]`. After the post lands,
      select the new thread and read its detail meta strip (`.fvd-meta`).
    expected: >-
      The New action opens a centered pop-out over the Issues page, not an inline form in the left list.
      The form carries exactly TWO text surfaces — the concern input and the body textarea — plus one compact
      store picker for local/configured forge stores; NO node-ids field exists (nothing placeholder-labelled
      "node ids"). Posted local threads show the linked node as a clickable chip — the store inferred
      `nodes:` from the body's `[[…]]` link ([[local-issues]]), the writer never re-typed an id into a
      separate field. A forge post writes the same node link as a `Spec:` marker and, after the forced forge
      read-back, the issue appears with that node chip. No page errors.
  - name: close-issue-button
    tags: [frontend-e2e]
    code: [spec-dashboard/src/IssuesPage.jsx, spec-dashboard/src/Thread.jsx, spec-cli/src/issues.ts]
    description: >-
      Run the issues page against a backend with a disposable LOCAL issue store. Select an open issue,
      read the detail's Close issue action beside Send in the thread composer action row, click it, and
      read the subsequent issue list plus the network response. When a non-disposable forge fixture is
      present, only inspect that the same detail affordance renders for the forge issue; do not close a
      real remote issue as evidence.
    expected: >-
      Each non-concluded issue detail shows one Close issue action in the thread composer's action row
      beside Send, GitHub-style, and no close action in the title's top-right chrome or a separate row.
      Clicking it posts to the same dashboard close route, disables while pending, then reloads the
      resident issue list. The local issue is resolved in the disposable local store; with the default
      concluded-hidden filter, it disappears from the visible list after the write. The same button renders
      for a forge issue because the frontend does not branch by store; the remote write path is the
      store-routed backend route. A concluded issue shows no Close button. No page errors.
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
      each, and read the detail header's originator chip (`.fv-originator`): its alive/offline class, the
      dot's computed background colour, whether the ONLINE originator is a click target, and whether the
      old reach phrase is absent.
    expected: >-
      Each local issue's header shows the originator id with a liveness dot and no visible reach phrase. The
      ONLINE originator reads `alive`, uses a status-hued dot from the board's `STATUS_COLOR`, renders as a
      clickable chip, and clicking it opens `#/sessions/<id>` with that session selected. The absent
      originator reads `offline`, uses the muted dot, and is not clickable. A forge issue's github-login
      `by` resolves to no session and stays a plain author label. No second palette, no page errors.
  - name: lifecycle-actions-parity
    tags: [frontend-e2e]
    code: spec-dashboard/src/IssuesPage.jsx
    description: >-
      Run the dashboard against a backend on a DISPOSABLE local store (SPEXCODE_ISSUES_DIR) seeded with
      agent-authored OPEN local issues. Open #/issues, select one, and read the composer action row:
      which lifecycle buttons render (Sign / Accept / Reject / Promote / Close issue). Click Sign and
      re-read the meta strip and the action row; click Accept on one issue and Reject on another and
      re-read status + list membership. Verify Promote renders on an open local issue but do NOT click
      it through (a real forge issue would be created); select a non-open issue and re-read its row.
    expected: >-
      An OPEN local issue's composer action row carries the whole human-reachable local lifecycle at CLI
      parity beside Send: Sign, Accept, Reject, Promote, Close issue. Sign POSTs the store-routed sign
      (author 'human'): the "+N signed" badge appears/increments and the Sign button hides (human is
      already a signer). Accept resolves accepted — the status chip flips and the issue STAYS listed
      (approved-not-landed), the open-only verbs (Accept/Reject/Promote) gone. Reject resolves rejected —
      the issue disappears under the default concluded-hidden filter into the archive chip's count.
      Promote renders only on an open LOCAL issue. A concluded issue never grows the lifecycle verbs
      (and a forge issue keeps Close only). A refused write surfaces its server message in the row.
      No page errors.
---

# measuring issues-view

YATU through the REAL running dashboard, never the code: a backend seeded with local + forge issues, the
worktree dashboard pointed at it, and a headless Chromium that opens #/issues and reads the live DOM
(`.fv-master`, `.fv-row`, `.fv-store`, `.fvd`, `.doc-body`) + screenshots it. The loss is the gap between
that reading and the spec: a master-detail Issues page (its own top-level route, no in-page switcher),
one merged store-tagged list in API order, markdown-rendered detail, one thread surface and one composer
over both stores. (This reading style is
what caught the `t(...)` i18n call-convention crash a build could not.)
