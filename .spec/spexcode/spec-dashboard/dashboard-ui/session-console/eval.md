---
scenarios:
  - name: live-pane-disposes-on-offline-transition
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/resource-terminal-lifecycle.e2e.mjs
    code: spec-dashboard/src/SessionInterface.jsx
    related: [spec-dashboard/src/SessionTerm.jsx, spec-dashboard/src/TimelineChat.jsx]
    description: >-
      Open a pane-backed session in Chromium with a live board projection, then deliver an authoritative board
      frame marking that same session offline and archived. Observe the real mounted terminal and the replacement
      Conversation surface after the projection settles.
    expected: >-
      The live frame mounts exactly one xterm layer. The offline/archived frame disposes that layer and its socket
      while retaining one readable Conversation layer; no hidden terminal remains to charge the retired session.
  - name: terminal-input-default-and-suspended-confirm
    tags: [frontend-e2e, desktop, backend-api]
    code: [spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/SessionTerm.jsx]
    description: >-
      Open a live pane-backed session and immediately type a harmless key. Then open a suspended session whose
      TUI is waiting at a token-consuming Enter confirmation and type one key, inspect the confirmation focus and
      websocket input frames, cancel, repeat, and confirm once. Leave and reopen both sessions.
    expected: >-
      The active session's terminal accepts the harmless key immediately and renders it in the real tmux pane.
      Opening or switching sends no resume request and no input frame. The suspended session's first key opens a
      confirmation that is not pre-focused and is spatially separate from the cursor; Enter cannot confirm it by
      landing on the control. Cancel sends no key. Confirm sends exactly the held key once. Leaving or reopening
      does not replay input or resume implicitly. Archived sessions remain Conversation-only and read-only.
  - name: timeline-message-composer-contract
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/timeline-chat-composer.e2e.mjs
    code: spec-dashboard/src/TimelineChat.jsx
    related: [spec-dashboard/src/Composer.jsx, spec-dashboard/src/textarea.js, spec-dashboard/src/styles.css]
    description: >-
      Open a real headless session's TimelineChat at 1280x800. Type one, two, three, and enough lines to
      exceed the input cap; press Shift+Enter, dispatch an IME-composing Enter, press the composer after a
      timeline selection, then press plain Enter on a unique token and read the persisted session timeline.
    expected: >-
      The shared ComposerTextarea grows at two and three lines with overflow hidden and
      `scrollHeight <= clientHeight`, enables scrolling only beyond its CSS cap, and remains the active layer's sole focus sink. Shift+Enter adds a line without
      sending, a composition Enter neither changes nor sends the draft, and plain Enter delivers exactly one
      sent event then clears the draft. Pressing the composer clears the timeline highlight without losing
      focus, and desktop activation focuses the mounted textarea.
  - name: cold-session-conversation-is-readable
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/session-surface-cold-readable.e2e.mjs
    code: spec-dashboard/src/SessionInterface.jsx
    related: [spec-dashboard/src/TimelineChat.jsx, spec-dashboard/src/styles.css]
    description: >-
      In an isolated real backend, create terminal-capable sessions with persisted conversation entries, then
      close one and stop the other through the public session APIs. Select each row in a real Chromium dashboard,
      compare its rendered timeline with the public timeline endpoint, exercise the terminal control and lifecycle
      action, and count archived timeline requests for longer than one polling interval.
    expected: >-
      Archived and offline sessions retain the same Conversation tabs, timeline body, and shared footer shell as a
      live session. Their persisted entries render, the composer is disabled and cannot take focus, and the terminal
      control remains visible but disabled without changing surface. The archived footer reads
      `▤ 已归档 · 内容只读` with one usable `取回` action; the offline footer reads
      `⏻ agent 已离线 · 内容只读` with one usable `重新启动` action. The archived selection performs exactly one
      timeline read across an interval longer than eight seconds, and both actions use the real resume endpoint.
  - name: headless-stop-relaunch-preserves-history
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/lifecycle-outcome.e2e.mjs
    description: >-
      Open a real governed headless session's desktop console in Chromium after its timeline contains a unique
      declaration note. Use Alt+I to run `/stop`, inspect the read-only Conversation footer and available commands,
      click its relaunch action, then inspect the restored conversation and public timeline.
    expected: >-
      `/stop` is handled as the real board command and never sent as agent text. The Conversation timeline remains
      visible while its shared footer disables the composer, reports the offline read-only state, and offers
      relaunch; Command Box is unavailable. While the relaunch request is pending, its one right-pane status reports
      a lifecycle transition (`working...`), never a message delivery (`sending...`); prompt dispatch retains its
      own sending outcome. Relaunch returns the session online and re-enables the same conversation with the unique
      pre-stop note and timeline intact.
  - name: dashboard-session-state-push-latency
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/session-state-push-latency.e2e.mjs
    code: spec-dashboard/src/SessionContextMenu.jsx
    related: [spec-dashboard/src/data.js, spec-cli/src/graphStream.ts, spec-cli/src/graphCache.ts, packages/spec-core/src/graph.ts]
    description: >-
      In an isolated real backend and Chromium dashboard, right-click one real persisted session row and rename
      it three times through the modal. Record A (gesture to record persist), B (persist to sessions signal), C
      (signal to projection complete), D (projection complete to target browser SSE; queue-to-browser is retained
      separately), SSE-to-DOM, and E (gesture to
      rendered row), plus all graph HTTP requests.
      Pair that browser trace with the graph-cache held-full controls: route-owned and patrol-owned
      full producers must remain held until the target session frame is observed, then complete structurally
      without a session rollback.
    expected: >-
      Each successful rename is visible through the target graph SSE frame, with no HTTP response containing that
      target winning the render before the raw target SSE. All three ordinary persist-to-browser-SSE measurements
      are reported as one distribution and each must meet the unchanged 200ms budget; SSE-to-DOM must meet 100ms;
      any miss is filed FAIL rather than selected away. A/B/C/D, SSE-to-DOM, and complete browser end-to-end timing
      are retained with the browser video, terminal screenshot, and structured trace. Under an active full lasting over 15s, the target session frame occurs before full release/completion;
      the later structural frame preserves that name, and watcher-disabled patrol repair does not turn session
      rename state into the full builder's queue.
  - name: native-terminal-default-input
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/terminal-input.e2e.mjs
    description: >-
      Open a live session in a real browser and immediately type prose, arrows, Escape, and committed Chinese
      IME text into the agent TUI. Inspect focus, terminal WebSocket messages, and the rendered TUI response.
    expected: >-
      The xterm is focused and interactive without entering a mode. Its native ordered data reaches the same
      visible tmux client exactly once, including committed IME text. There is no docked second input, type-mode
      indicator, raw-key HTTP batch, screen sniff, or general DOM-key vocabulary; the sole Shift+Enter bridge
      emits the modified `ESC CR` sequence rather than collapsing into ordinary Enter.
  - name: command-box-opens-and-grows-upward
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/command-box.e2e.mjs
    description: >-
      In a live terminal press Alt+I, measure the Command Box and terminal before and after entering
      several lines, then close and reopen it. Repeat in a narrow desktop pane and press Alt+Shift+I.
    expected: >-
      The named Command Box opens focused and horizontally centered in the lower middle, with its bottom edge
      near 68% of the terminal pane. Its width shrinks safely; its footer stays fixed while content grows upward
      to a cap; xterm geometry never changes. Close/reopen preserves the session draft and returns focus to the
      TUI. Alt+Shift+I is not consumed by the app.
  - name: command-box-send-failure-and-success
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/command-box.e2e.mjs
    description: >-
      Author a multi-line prompt in Command Box, force a public 502 dispatch failure, retry, then restore the
      live control channel and send successfully while observing the draft, outcome surface, request count,
      and TUI. Force the selected session's relaunch endpoint to return the public readiness refusal, retry it,
      and inspect both desktop and phone list geometry.
    expected: >-
      The Command Box exposes sending then one visible 502 failure while retaining its complete draft and
      delivery marker for retry; no left-list action alert appears. A successful retry reuses that marker,
      sends one atomic control prompt, visibly acknowledges delivery in that same surface, then clears the
      draft, closes the box, and focuses xterm. The public
      `launch did not become ready; the session remains stopped and can be retried` refusal appears once in the
      selected Conversation footer's relaunch outcome, survives until retry, and never changes list geometry on desktop or
      phone. Neither attempt types the prompt character-by-character through the PTY.
  - name: command-box-commands-mentions-and-files
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/command-box.e2e.mjs
    description: >-
      Open Command Box and exercise `/`, `[[`, and `@` completion plus paste/drop/pick attachment. Accept a
      board command row and authoring rows, then send a known node reference against the live spec index.
    expected: >-
      Board commands lead the slash list tagged ui and execute locally from the toolbar registry; `/type` is
      absent. Presets and harness commands insert text. Node/session menus are the shared mention menus and a
      known `[[node]]` expands at send to its live spec.md pointer. An attached file becomes one worker-local
      path in the draft. Menus fit above the lower-middle box without covering its footer.
  - name: board-command-parity
    tags: [frontend-e2e, desktop]
    description: >-
      Across working, review, done, offline, and queued sessions compare toolbar tools with Command
      Box board rows. Trigger Command Box, merge, relaunch, stop, close, and eval through
      each available surface.
    expected: >-
      One registry decides availability, icon, color, accessible label, and action. Every selected session
      keeps the merge slot: only an online `awaiting` review with `proposal:merge` is green, clickable,
      and offered as `/merge`; each activation is one bodyless `POST /merge` with no review preflight or
      idempotency header. done/`nothing`, working, asking, close-pending, and offline states are muted,
      disabled, name their reason, and dispatch nothing. Command Box is the stable resident right-edge tool
      while live; merge/relaunch sit to its left without moving merge. Stop and close remain Command Box-only
      typed verbs with no toolbar twin; archived sessions are places in the left archive surface, not a command
      mode. Eval is a permanent
      anchor plus `/eval`. Offline and queued sessions cannot open Command Box, and no `/type` or type tool exists.
  - name: modifier-arrows-switch-sessions
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/session-shortcuts.e2e.mjs
    description: >-
      With focus in New Session, Command Box, the live xterm, and inert console chrome, press plain and
      Cmd/Alt/Ctrl-modified Up/Down and observe both session selection and the focused surface.
    expected: >-
      Plain arrows stay with textareas and xterm but navigate the list from inert chrome. Each documented
      modifier-arrow chord switches one visible session from every focus location without leaking into the
      TUI. App-global Alt chords still route through the shell.
  - name: session-sidebar-density-and-selected-cap
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/command-box.e2e.mjs
    description: >-
      Clear the saved pane width, open a console with short and very long generated session headlines, select
      the longest row, then resize the sidebar and inspect typography, row geometry, tooltip, and terminal width.
    expected: >-
      The default sidebar is 204px, remains user-resizable, and uses caption-size row text. Resting rows stay one
      line. Only the selected headline expands, to no more than three lines; its complete text remains in the
      tooltip/accessibility name and status metadata stays at the first-line top-right. No row overlap occurs.
  - name: session-sidebar-viewport-scroll
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/session-archive-zone.e2e.mjs
    code: spec-dashboard/src/styles.css
    related: spec-dashboard/src/SessionInterface.jsx
    description: >-
      In an isolated real backend and prebuilt Chromium dashboard, render working rows plus a long closed index,
      then inspect the complete SessionInterface sidebar and archive zone geometry.
    expected: >-
      The sidebar remains bounded inside the routed page. The working-board region owns its only vertical
      scrollport; the permanent archive zone stays visible at zero, remains in the same scroll flow, and does not
      introduce a second scroll container.
  - name: archive-zone-and-index-overlay
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/session-archive-zone.e2e.mjs
    code: spec-dashboard/src/SessionInterface.jsx
    related: [spec-dashboard/src/styles.css, spec-dashboard/src/session.js]
    description: >-
      Through an isolated real backend and the prebuilt dashboard in Chromium, begin with no closed sessions,
      create real working sessions, drag one row onto the archive zone heading, expand the zone, click its `View all`
      row to open the archive overlay, then add a long closed-index fixture and search that overlay while counting requests.
    expected: >-
      The top row has only New and Search; the final `archive 0` zone is still visible and folded. Its count chip
      toggles the zone without changing selection, and opening it shows only the newest bounded rows plus one
      `View all N` row. The header button toggles from its label and trailing rule area, and carries the only
      `aria-expanded`; the chip is a visual marker. The closed rows use ordinary session-row treatment; the `View all N` button uses the same
      row geometry, normal ink, bottom rule, hover wash, and right-side chevron column but never a selected state.
      The sidebar still has exactly one scroll container. Dropping a row on the visible zone heading issues one close
      without a dialog and moves it into the archive; dragging near the viewport edge auto-scrolls until that heading
      is visible. `View all N` opens a transient overlay, whose complete closed index filters locally, groups newest-first
      under sticky dates, closes on Esc, and hands an explicitly selected row to the read-only Conversation rather than
      changing the right-pane shape. It receives the complete closed index in one request and renders newest-first rows
      beneath sticky date headings whose active heading remains fixed during scroll.
  - name: triage-zones-and-status-colour
    tags: [frontend-e2e, desktop]
    description: >-
      Render sessions spanning actionable, working, starting, queued, and offline liveness, including a dead
      session whose authored lifecycle remains review. Inspect grouping, ordering, glyphs, tooltips, and colors.
    expected: >-
      Needs-you, running, and offline zones are in that order, newest-first within each. Offline liveness wins
      over stale lifecycle for grouping. Compact rows use the shared status glyph and STATUS_COLOR vocabulary,
      with the full status in the tooltip and no duplicate toolbar identity/status line.
  - name: terminal-selection-survives-mouse-mode
    tags: [frontend-e2e, desktop]
    description: >-
      In a real mouse-reporting TUI, plain-drag-select terminal text (no modifier) while the application
      requests DEC mouse modes, copy with Cmd/Ctrl+C, hover the pointer across the pane, and wheel
      through history.
    expected: >-
      Plain drag produces one uninterrupted LOCAL selection — the pointer is always the browser's, no
      button or motion report ever reaches the application — and copy works on secure and plain HTTP
      contexts without moving the glyph grid. Hover emits nothing. The wheel follows tmux's native
      routing (copy-mode or the mouse-owning application), and keyboard input remains live through
      xterm.
  - name: terminal-toolbar-and-eval-tab
    tags: [frontend-e2e, desktop]
    description: >-
      Switch between a live pane-backed session and a real `claude-headless` session, then route through the
      permanent Eval tab at wide and narrow desktop widths across themes, locales, long headlines, Command Box
      visibility, and eval loading/error/zero states. Let the headless session settle with timeline events and
      inspect the right pane and toolbar.
    expected: >-
      The pane-backed session keeps its warm Terminal pane. The headless session has no terminal or tmux socket:
      its main console is the shared TimelineChat (timeline + declaration notes + fixed `replyVia:"note"`
      composer). Eval is a real canonical navigation tab, fixed immediately after the current base surface before the resource
      tab strip, and no inline eval pane mounts. The compact
      toolbar stays one line, visually separate from either console, with honest eval summary states and all
      available icon tools visible. Its fixed merge slot turns green only for the live `done --propose merge`
      review proposal; all other proposal/lifecycle/liveness cases stay muted and disabled without shifting the
      toolbar. The warm terminal survives navigation and browser Back.
  - name: eval-tab-and-resource-picker-order
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/session-toolbar.e2e.mjs
    description: >-
      Open a real session console in Chromium and measure the session toolbar while its current surface is visible.
      Follow keyboard focus from the current surface through the right edge of the tab rail.
    expected: >-
      The visual and keyboard sequence is current surface, the real Eval navigation tab, resource tabs, the
      resource-picker plus button, then one contiguous group of right-edge tools. Opening a resource leaves Eval
      immediately after the current surface rather than moving it. This tab sequence is compact: a one-pixel
      divider and short gutter distinguish Eval from a compact circular plus control; its right side has no
      matching divider. That plus stays visibly subordinate to the command tools — a smaller box than a tool's,
      a thin neutral ring at rest, accent only under hover or keyboard focus. Files and the
      Terminal/Conversation switch use the same icon gap as the command tools, with no wrapper-created group
      gutter. There is no flexible spacer or separate Eval control between the current surface, Eval, resource tabs, and picker.
  - name: posted-resources-are-singleton-tabs
    tags: [frontend-e2e, desktop, cli, backend-api]
    test: spec-dashboard/test/session-web.e2e.mjs
    description: >-
      Open a real selected session in the served dashboard, publish a loopback webpage from the real
      CLI, inspect its automatic tab and same-origin frame, then click a filename in the top-right file menu and use the
      trailing plus picker to open, close, reopen, refresh the file from the right action group, and retract
      the resources.
    expected: >-
      The toolbar stays single-line while resource labels clip or scroll. A fresh web publication gets one
      selected tab only for the selected session; neither clicking an already-open filename nor the plus picker duplicates an
      open resource or creates an overlay preview. A selected file has right-side refresh, download, and copy-path
      actions and no merge action; a selected web has the same refresh action but no download, copy-path, or merge;
      the Terminal surface has merge and no resource actions. Refreshing the web resource recreates its iframe and
      requests a newer service response. Selecting the web tab focuses its iframe without a content click, and a direct ArrowRight
      changes the published slide page; Escape closes a top resource-picker layer before a following Escape returns the
      native console sink, while documented Alt dashboard chords remain live. Switching through file, web,
      Terminal/Conversation, and a second session retains each open resource's same DOM instance: the web iframe has the
      same contentWindow and preserved in-frame scroll, while the file preview makes no second preview request and retains
      its preview scroll. Multiple open resources remain isolated from each other's state. Refresh is the explicit
      exception: it rereads that file or recreates that webpage frame only. Closing permits one later reopen, and retracting
      removes the tab because its authorization is gone while the warm console remains hidden and pointer-inert underneath.
      Opening eight warm resources for one live session never disables or blocks another live session from opening and
      retaining its own resource: resource tabs have no cross-session admission cap, eviction, or starvation.
  - name: session-remembers-its-local-surface
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/session-toolbar.e2e.mjs
    description: >-
      In Chromium, start with a pane-backed session on Terminal, switch to Conversation from the icon beside
      the top-right files control, reload, and open then close a posted file resource. Separately set the
      Settings default to Conversation, open an otherwise unchosen pane-backed session, explicitly switch it
      to Terminal, change the default again, and reload.
    expected: >-
      Terminal and Conversation are mutually exclusive base surfaces. An explicit pane-backed choice persists
      per browser/project/session across reloads and always wins over the Settings default; an unchosen session
      follows that default, while headless stays Conversation. A resource tab is only a temporary local overlay:
      closing it or returning with Escape restores the resolved base without changing it. Neither choice writes
      a session record or backend state.
  - name: create-stays-on-new-and-close-falls-back
    tags: [frontend-e2e, desktop]
    description: >-
      Launch several sessions quickly from New Session, then close the active and a background session while
      observing prompt focus, URL selection, and list updates.
    expected: >-
      Launch clears immediately, stays focused on New, and never waits or auto-switches. Removing the active
      session falls back to New; removing a background session preserves the current valid selection.
  - name: launcher-picker-is-config-shaped
    tags: [frontend-e2e, desktop]
    description: >-
      Open the New Session launcher picker with multiple configured Claude/Codex profiles, select one, reload,
      then remove that profile from settings and revisit the picker.
    expected: >-
      A centered pop-out lists each profile once with its harness icon, name, full inert command, and selected
      state. Selection closes and persists while valid, otherwise the configured default wins. No inline command
      editor or launcher-configuration controls appear.
  - name: row-context-and-external-reveal
    tags: [frontend-e2e, desktop]
    description: >-
      Right-click a nested session row, exercise lock/rename/attach/close availability, then open
      a session hidden below collapsed ancestors from the graph node menu and an originator chip.
    expected: >-
      The shared context menu exposes state-appropriate actions without stealing terminal focus. Close remains
      the one lifecycle-removal command there; archive is a destination in the sidebar rather than a context-menu
      verb. External opens
      unfold every present ancestor, reveal and select the row, and keep URL/session identity synchronized.
  - name: session-window-remains-bounded
    tags: [frontend-e2e, desktop]
    description: >-
      Open a graph with live sessions and inspect the compact SessionWindow badge in the graph's upper-right
      corner. Open the badge, filter the shared picker, choose a session to lock the graph, and double-click a
      row to navigate into that session.
    expected: >-
      The graph shows a bounded count-and-avatar badge at rest, with no second full session list. Expansion opens
      the shared SessionPicker with the same avatar, stable handle, and lifecycle glyph language as the dock,
      graph menu, mentions, and prose dispatch. Choosing a row locks the graph; double-clicking navigates to
      `#/sessions/<id>`; the full forest remains owned by the dock.
  - name: offline-history-disclosure
    tags: [frontend-e2e, desktop, mobile]
    test: spec-dashboard/test/session-tree-disclosure.e2e.mjs
    description: >-
      Against a board carrying several retained terminal/offline history sessions (an adopter's deep-linked CR
      records is the live case), use a real browser to inspect the narrow SessionInterface sidebar, the
      map-side SessionWindow, and the phone Sessions list. In each surface inspect the offline zone and a
      nesting parent at rest; click the parent row body, then its leading child-count pod; click the OFFLINE
      header label and trailing rule area; finally select or deep-link an offline/nested session from outside the
      folded list. In the desktop console, press Alt+Shift+ArrowDown then Alt+Shift+ArrowUp on the selected
      parent; repeat Alt+Shift+ArrowDown on a live leaf while Command Box owns focus.
    expected: >-
      At rest the offline zone shows ONLY its header row with the hidden count (aria-expanded=false) — the
      dormant history no longer floods the list. Needs-you and running rows are all present at every fold
      state. The header has the count marker before the OFFLINE label and no `>`/chevron/caret/`▸` direction
      symbol. The whole header carries the only `aria-expanded` and toggles from its label, trailing rule area,
      Enter, or Space. Parent rows likewise put their child count before the title/status body. Only those leading
      parent count pods carry `aria-expanded` and toggle: row-body clicks select/open/lock as native to the surface
      without changing the parent fold. The controls are siblings, with no button nested in a button. A session selected by URL/search/menu
      stays rendered and its present ancestors unfold as required, while a deep-linked offline row remains
      visible even when the offline zone itself is folded. On desktop, Alt+Shift+ArrowDown/ArrowUp
      expands/collapses the selected parent without moving the selected tab; on a leaf the chords are consumed
      as no-ops. No session record is deleted or mutated by any of it.
  - name: headless-conversation-mount-is-bounded
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/command-box.e2e.mjs
    description: >-
      Open a desktop console backed by many headless session rows (including retained offline history), record
      timeline/detail requests and visible conversation mounts before and after selecting one headless row, then
      switch away and back.
    expected: >-
      Before selection, unvisited headless rows render no TimelineChat and issue no timeline/detail requests.
      Selecting one mounts exactly its conversation and performs its bounded reads; switching away stops its
      refresh timer without discarding the rendered history, and returning resumes from that history without a
      duplicate mount storm. Live pane-backed terminals keep their existing warm sockets.
  - name: corrupt-record-quarantine-context-control
    tags: [frontend-e2e, desktop, backend-api]
    description: >-
      Open a real corrupt governed row in Chromium, open its right-click action menu, fill the exact
      adapter/thread/tmux/worktree/branch witness in the quarantine modal, first submit with a live claimed
      resource and then after the real absence proof is true.
    expected: >-
      Only a corrupt row exposes Quarantine. The live/unknown control refusal remains visible through the
      shared action-error surface and preserves the row. A verified submission removes the row from the active
      dashboard without inventing a lifecycle, while the matching API resource report has no corrupt owner.
      Restore returns the same corrupt row rather than a runtime or readable replacement record.
  - name: lifecycle-confirm-owns-enter
    tags: [frontend-e2e, desktop]
    code:
      - spec-dashboard/src/SessionInterface.jsx#SessionInterface
      - spec-dashboard/src/Modal.jsx#Modal
      - spec-dashboard/src/SessionContextMenu.jsx#SessionContextMenu
    description: >-
      Keep the console on its New Session document, open a real row's context menu, and choose Close. Verify the
      destructive button has focus, then press Enter through the page-level keyboard.
    expected: >-
      A focused lifecycle confirm owns Enter even while the underlying console document is New: the press
      dismisses only the visible dialog and sends the close request exactly once. The New Session router never
      launches a session behind an overlay, and opening the confirm causes no request until its own commit gesture.
---

Measure these scenarios through the running dashboard and real sessions. Dynamic focus, terminal input,
Command Box growth, and routing require recorded browser interaction; static sidebar geometry uses screenshots.
