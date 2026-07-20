---
scenarios:
  - name: renders-merged-issues
    tags: [frontend-e2e]
    code: spec-dashboard/src/IssuesPage.jsx
    description: >-
      Run the dashboard against a backend whose issues span both stores (a local thread with a reply,
      forge issues). Open #/issues and read the rendered DOM: the list rows (tag + href), then open
      the local thread's detail page and read it; check for raw markdown syntax in the detail.
    expected: >-
      The list renders open rows in the API's order (no re-sort/rank) as REAL <a> anchors to
      #/issues/<id>. Every shared structured row leads with the issue state: open rows use the
      original 16px GitHub Primer
      `issue-opened` Octicon geometry (ring + centre) in the theme's semantic open green, never the old
      8px solid dot; after the Closed section is selected, both local `landed` and forge `closed`
      rows use Primer's matching 16px `issue-closed` geometry (ring + check) in the one semantic closed
      purple, never compact CSS dots. Then comes the wrapping concern; identity, originator, and opened time
      occupy the secondary line, while real comments/store/node facts sit at the right. At 390px the same
      markup wraps the title and moves trailing facts beneath it without horizontal overflow. The issue
      title face matches the Evals scenario title; NO boxed store chip leads a row. Open/Closed tabs carry
      their true counts and every non-open issue belongs to Closed. Opening the
      local thread lands on its own DETAIL PAGE (#/issues/<id>, a history push): the title is the concern
      ALONE (no store chip on the title); the status band under it carries the status; the SIDE rail
      carries the store tag, author, clickable node chips; the body and replies MARKDOWN-RENDERED in the
      main column (headings/tables/lists — no raw `##` or `|` pipes
      visible), and a reply composer. A forge detail renders the SAME way — its GitHub comments as
      the reply thread, its permalink in the side rail labeled with the store's concrete display name
      ("Open on GitHub" for a github issue, "Open on GitLab" for a gitlab issue — derived from the
      issue's `store` identity, never the internal word "forge"), and the SAME composer (no read-only
      note exists) — store never changes the thread's shape. A local issue shows no permalink. No page
      errors.
  - name: composer-mention-autocomplete
    tags: [frontend-e2e]
    code: [spec-dashboard/src/IssuesPage.jsx, spec-dashboard/src/mentions.jsx]
    description: >-
      On the running issues page, select a LOCAL issue and type into its reply composer, then open the
      New form and type into its body textarea. In each: type `@`, read the dropdown, pick the `@new` row
      with ↓/Enter, read the launcher rows that replace it, pick a non-default launcher, and read the
      inserted text; clear, type `[[` (and a partial id), pick, read the insertion;
      press Esc with a menu open and read the hash; type plain prose and look for any menu. Then visit
      the session console and re-check its `@`/`[[` menus still open (the shared-module regression).
    expected: >-
      Both composers carry the console's OWN mention dropdowns ([[mentions]] — one shared menu, not a
      fork): `@` lists the live sessions plus `@new`; accepting `@new` opens one row per configured
      launcher, and accepting a launcher inserts `@new:<launcher> ` (trailing space), while a live-session
      pick still inserts `@<id> `. `[[`
      lists the spec nodes (a partial query filters) and a pick inserts `[[<id>]] `. The reply
      composer's menu opens UPWARD (visible above the docked textarea), and the New form's menu also opens
      UPWARD outside the New pop-out itself, never inserted into or clipped by the modal body and never
      covering the store/concern controls. Esc closes the menu, keeps the draft, and stays on #/issues. Plain text never opens a menu. The
      console's `@`/`[[` menus are unchanged. No page errors.
  - name: composer-trigger-buttons
    tags: [frontend-e2e]
    code: [spec-dashboard/src/Thread.jsx, spec-dashboard/src/mentions.jsx]
    description: >-
      On the running issues page, select a LOCAL issue. In the reply composer's action row read the two
      symbol buttons (`@` and `[[`): their aria-labels/tooltips. Seed a draft with prose, place the caret
      mid-draft (after a space), click the `@` button, and read the textarea's value, focus, selectionStart,
      and any open menu; Esc, then SELECT a span of the draft and click the `[[` button and re-read. Check
      no reply was posted. Re-read the action row's child geometry at desktop and at a ~780px window
      (bounding rects: no overlap, nothing outside the composer).
    expected: >-
      Each button inserts its EXACT trigger at the caret — `@` between the prose halves, `[[` replacing the
      selected span — preserving the rest of the draft; the textarea is focused with the caret right after
      the inserted trigger, and the ONE shared autocomplete opens naturally over it (the SAME `.mention-menu`
      typing the trigger opens: sessions + `@new` for `@`, spec nodes for `[[`) — no second menu
      implementation, no dispatch, no post. Both buttons are compact symbol-only toolbar buttons wearing a
      localized aria-label and the shared `data-tip` tooltip. At desktop and ~780px the row's controls
      (triggers, lifecycle actions, Send) all render without overlap or spill. No page errors.
  - name: issue-reply-video-plays
    tags: [frontend-e2e]
    code: [spec-dashboard/src/Thread.jsx, spec-dashboard/src/Evidence.jsx]
    description: >-
      Cache a real clip with `spex blob put <clip.webm>` (no reading filed), post a LOCAL issue reply
      whose body carries a `![video](/api/evidence/<hash>)` link (same hash as the reply's evidence),
      plus a reply with an image link and one with a hash whose blob is absent. Open #/issues, select the
      thread, and read each rendered reply's real DOM: the media element's tag, its readyState/currentTime
      after play(), and whether raw markdown link text shows in the prose.
    expected: >-
      The video-linked reply renders a real playing HTML5 `<video class="eval-video" controls>` sourced
      from /api/evidence/<hash> — frames decode (readyState ≥ HAVE_CURRENT_DATA, currentTime advances
      after play()), never a broken `<img>` and never raw markdown in the prose. The image link still
      renders as an image (click-to-enlarge), and the absent blob renders the honest miss sentinel. The
      element is the SAME shared-renderer output the eval tab and eval detail produce for the same hash —
      one evidence renderer, every home.
  - name: composer-docked-autogrow
    tags: [frontend-e2e]
    code: [spec-dashboard/src/IssuesPage.jsx, spec-dashboard/src/Thread.jsx, spec-dashboard/src/textarea.js]
    description: >-
      On the running issues page, open the detail page of an issue whose thread is LONG (body + replies
      overflow the viewport). WITHOUT scrolling, read the reply composer's geometry (getBoundingClientRect
      on `.ds-compose` and its textarea) against the viewport; read the composer container's computed
      border/radius and the textarea's computed border-style; read the IDLE textarea's height (before any
      click/focus) and whether the actions row (`.fv-actions`) is present, what it contains, and whether
      any always-visible hint text renders. Focus the textarea and re-read; type several lines and read
      the height after each; clear and blur and re-read. Then scroll the thread and read whether
      the composer stays on screen. Repeat the idle/engaged reading on an eval detail's composer (#/evals).
    expected: >-
      The composer is DOCKED STICKY at the main column's foot — visible in the viewport immediately on
      page open, no scrolling needed even on a long thread; the thread scrolls behind it and the composer
      stays on screen. The composer is ONE quiet bordered rounded
      container; the textarea inside it is BORDERLESS (computed border-style none) and IDLE it is
      ALREADY USABLE — a two-line floor (~40px, never a one-line ~26px sliver), needing NO click/focus to
      reach that height: the box you land on is the box you can write in. Focus does not change the
      textarea's height (there is no click-to-expand), and the compact action row is already visible with
      a disabled icon-only Send (an accessible name/tooltip, at the row's RIGHT edge) plus any
      clip/lifecycle action supplied by the host; NO always-visible hint line renders anywhere in the
      composer. Typing still AUTO-GROWS it beyond that idle floor, line by line, capped so it never eats
      the pane; an emptied, blurred composer settles back to the same usable idle floor, never collapsing
      to a hairline line, and the action row stays visible throughout; for a non-concluded issue it shows
      Promote/Close issue beside the disabled Send, and for a home with no lifecycle action, such as the
      eval detail's composer, idle still shows the disabled Send (plus ⏱ over a clip). Another issue's
      page starts with a fresh draft (keyed to the issue). One shared composer, every home. No page errors.
  - name: detail-composer-column-alignment
    tags: [frontend-e2e]
    code: [spec-dashboard/src/IssuesPage.jsx, spec-dashboard/src/styles.css]
    description: >-
      On the running issues page at a wide desktop viewport (~1600px), open the detail page of an issue
      with a body and replies. Measure bounding rects of the detail's title (.ds-title), body, a reply,
      and the docked composer's quiet bordered box (.ds-compose .fv-compose): left edges and right edges.
      Re-measure at a ~780px window; check document/body horizontal overflow at both widths.
    expected: >-
      The body, replies, and the docked composer's quiet bordered box share ONE main column — the
      same left edge and the same capped width at every viewport,
      wide or narrow: the writing box sits ON the column the prose above establishes, never offset a
      few px left/right of it and never stretched past the column while the content is capped. The title
      row is the one deliberate exception: it LEADS with the compact back anchor ([[review-chrome]]), so
      the title text starts after that anchor while the content column below stays put. The quiet
      1px rounded border belongs to the composer box alone. No horizontal overflow at either width. No
      page errors.
  - name: list-page-skeleton
    tags: [frontend-e2e]
    code: spec-dashboard/src/IssuesPage.jsx
    description: >-
      On the running issues page (#/issues), read the query + bordered ListView skeleton, row tag/hrefs,
      Open/Closed section tabs, direct menu buttons, and overflow menu. Select Closed and read the hash
      and the visible query text; reload at that address. Submit a query text, pick a menu value, and
      drive Back through each state. Drive j/k and Enter; then type 'j' inside the New-form input. Record
      history.length across a row click and drive browser Back.
    expected: >-
      The page is a GitHub-style full-width ListView: 32px query, 48px metadata header, ~64px desktop
      structured rows, each a REAL <a> anchor to #/issues/<id>; NO master-detail split. Open/Closed + counts
      sit left; Store is the direct menu and source-session presence uses functional overflow; author and
      spec node are query tokens with no menus; only real values appear. At 390px Store remains direct;
      body/document stay 390px. The list renders instantly from app-resident issues. A query edit, the
      Closed section (`?q=is:issue state:closed`), and every menu pick each PUSH the one canonical ?q
      address with the pick visible in the input text; reload and Back replay the exact row set. j/k move
      a visible CURSOR down the rows and Enter opens the cursor row's detail page; a row click pushes
      (history grows) and browser Back restores the exact filtered list. A key typed into an
      input/textarea reaches the input and never moves the cursor. An empty store says there are no
      issues yet; a query/section/menu zero says no issues match this view. No page errors.
  - name: node-issue-cards-route-internally
    tags: [frontend-e2e]
    code: [spec-dashboard/src/IssueCard.jsx, spec-dashboard/src/NodeView.jsx, spec-dashboard/src/IssuesPage.jsx, spec-dashboard/src/styles.css]
    description: >-
      On the running dashboard, focus a node whose bound issues include a long LOCAL issue id/concern and
      a forge issue. Read the node-info Issues tab cards: their DOM shape, measured width against the
      popup pane, document/body horizontal overflow, and canonical href targets.
    expected: >-
      Local and forge issue cards are rendered by one shared component with the same markup: issue id,
      muted store tag, status, and clamped concern. Long local ids and concerns truncate inside the card,
      never widen the node-info popup and never create a bottom horizontal scrollbar on
      the page/body. Each card exposes the internal `#/issues/<issue-id>` address target; a forge card's
      primary href is NOT GitHub directly. The forge permalink is
      still available only inside the selected Issues detail meta strip. No page errors.
  - name: new-form-node-links
    tags: [frontend-e2e]
    code: spec-dashboard/src/IssuesPage.jsx
    description: >-
      On the running issues page, open the New form and count its text surfaces and read every store
      picker's option text; then post an issue whose
      concern is plain prose and whose body links a real node with `[[<id>]]`. After the post lands,
      open the new thread's detail page and read its side rail.
    expected: >-
      The New action opens a centered pop-out over the Issues page, not an inline form in the left list.
      The form carries exactly TWO text surfaces — the concern input and the body textarea — plus one compact
      store picker for local/configured forge stores. Each option names its canonical store label exactly
      once (`local`, `github`, `gitlab` as configured), with no redundant initial/prefix such as `L · local`
      or `GH · github`; NO node-ids field exists (nothing placeholder-labelled
      "node ids"). Posted local threads show the linked node as a clickable chip in the detail's side rail — the store inferred
      `nodes:` from the body's `[[…]]` link ([[local-issues]]), the writer never re-typed an id into a
      separate field. A forge post writes the same node link as a `Spec:` marker and, after the forced forge
      read-back, the issue appears with that node chip. No page errors.
  - name: shared-listview-facets
    tags: [frontend-e2e]
    code: [spec-dashboard/src/IssuesPage.jsx, spec-dashboard/src/ReviewShell.jsx]
    description: >-
      With issues spanning stores, originators, nodes, and present/missing source sessions, open #/issues
      at desktop and 390px. Read section/menu/secondary-filter DOM and menu option values; pick Store and Source
      session values and read the visible query text and hash; type author:/node: prefixes and walk the
      suggestions; compare primitive classes with #/evals.
    expected: >-
      Issues and Evals consume the SAME `FacetMenu`/`SecondaryFilters`/ListPage classes, never a select.
      Menus exist only for the low-cardinality model dimensions — stores actually present and
      source-session presence — and every pick is token surgery into the visible query plus one PUSH.
      Originator and spec node have NO enumerating dropdown: author:/node: are typed or completed from
      bounded data-derived suggestions, and unknown values submit to the honest zero. No fake
      labels/projects/assignee buttons. Desktop menus are invisible label + chevron buttons; 390px keeps
      Store direct (its compact active face shows the selected store while the accessible name remains
      fully qualified) and presence in the semantic secondary Filters menu. Even with both active, the
      sections, Store, and Filters trigger do not overlap. Back restores every pick. New is the page-title
      action, not a filter. No page errors or horizontal overflow.
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
      resident issue list. The local issue is marked landed in the disposable local store; with the default
      concluded-hidden filter, it disappears from the visible list after the write. The same button renders
      for a forge issue because the frontend does not branch by store; the remote write path is the
      store-routed backend route. A concluded issue shows no Close button. No page errors.
  - name: originator-liveness-shown
    tags: [frontend-e2e]
    code: spec-dashboard/src/Thread.jsx
    description: >-
      Run the dashboard against a backend whose board lists live sessions. Seed one LOCAL issue whose `by`
      is an ONLINE session id and one whose `by` is an id absent from the board. Open #/issues, open
      each detail page, and read the side rail's originator chip (`.fv-originator`): its alive/offline
      class, the
      dot's computed background colour, whether the ONLINE originator is a click target, and whether the
      old reach phrase is absent.
    expected: >-
      Each local issue's side rail shows the originator id with a liveness dot and no visible reach phrase. The
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
      which lifecycle buttons render. Verify Promote renders on an open local issue but do NOT click
      it through (a real forge issue would be created); click Close issue on another local issue and
      re-read status + list membership.
    expected: >-
      An OPEN local issue's composer action row carries Promote and Close issue beside Send. It never
      renders Sign, Accept, or Reject. Promote renders only on an open LOCAL issue. Close posts the
      store-routed close; the issue disappears under the default concluded-hidden filter into the archive
      chip's count. A concluded issue never grows lifecycle verbs, and a forge issue keeps Close only. A
      refused write surfaces its server message in the row.
      No page errors.
---

# measuring issues-view

YATU through the REAL running dashboard, never the code: a backend seeded with local + forge issues, the
worktree dashboard pointed at it, and a headless Chromium that opens the #/issues pages and reads the live
DOM (`.lp-page`, `.lp-row` anchors, `.ds-page`, `.ds-side`, `.doc-body`) + screenshots them. The loss is
the gap between that reading and the spec: a GitHub-style list page + detail page pair (its own top-level
route family, state in the URL, push/Back navigation), one merged store-tagged list in API order,
markdown-rendered detail, one thread surface and one composer over both stores. (This reading style is
what caught the `t(...)` i18n call-convention crash a build could not.)
