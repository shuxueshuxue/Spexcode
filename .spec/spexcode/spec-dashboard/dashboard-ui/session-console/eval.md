---
scenarios:
  - name: close-tab-fallback
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) with at least
      two live sessions, A and B. Closing is reached ONLY by right-clicking a session row → "Close" →
      confirming the prompt (there is no header close button). First confirm the header carries no close
      control: with A selected, the tab bar's action row shows only the state-driven buttons (nav, relaunch/
      merge — proof is a TAB, not a button), never a "close"/kill button. Then two passes. PASS 1 — select A's tab, right-click A's row,
      pick Close, confirm, and watch where the view lands. PASS 2 — select A's tab, right-click A's row,
      pick Close, confirm, then immediately switch to B's tab while the close request is still in flight,
      and watch whether the view stays put. Measure by screenshotting the tab list + active pane before
      and after each close.
    expected: |
      The header action row never shows a close/kill button — closing is only on the row's right-click
      menu, behind a confirm. Pass 1: closing the tab you are viewing lands you on the New Session tab;
      A's row is gone from the list. Pass 2: having switched to B before the close settles, the view STAYS
      on B — the close never yanks you back to New Session. In neither case is the selected tab left
      pointing at a session the board no longer lists.
  - name: create-stays-on-new
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) and land on the
      New Session tab. Type a short launch prompt (e.g. `@<some-node> quick smoke test`) and press Enter to
      submit. Without clicking anything, watch the active tab and the session list for several seconds (long
      enough for at least one 4s board poll, so the new session has surely been listed). Crucially, check
      `document.activeElement` (or type the second prompt blind) BOTH while the first launch is still in flight
      AND after it settles, to confirm the box never loses focus at any point. Then type a second prompt and
      submit again. Screenshot the tab list + active pane mid-launch and right after each submit settles.
    expected: |
      Submitting never switches tabs: after each Enter the New Session tab stays the active/selected tab and
      its prompt is cleared, ready for the next launch — the view does NOT jump onto the freshly created
      session, nor does it bounce between New and the new tab. Focus stays in the prompt box across the submit:
      the box is NEVER disabled or blurred during the launch (it fires in the background), so
      `document.activeElement` is the `.si-input` textarea THROUGHOUT — mid-flight as well as once it settles —
      and the agent/attach icons never grey out. The second prompt types with no click, and can even be typed
      and fired while the first launch is still in flight, without the resolving launch clobbering the new
      draft. Each new session simply appears as a new row in the list below (surfaced by the board poll). Both
      sessions can be created back-to-back without ever leaving New Session. The only thing that moves your selection is a tab's removal (the close-command /
      close-tab-fallback scenarios — note `/stop` does NOT remove a tab, it only stops the session), never a
      creation.
  - name: stop-command-stops-keeps-worktree
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) on a LIVE
      (non-offline) session whose `❯` box is enabled. Type exactly `/stop` into the box (dismiss the `/`
      completion menu if it opened, so Enter dispatches rather than completes) and press Enter. `/stop` is
      the board's soft-stop verb — renamed off the old `/exit` that collided with Claude Code's own `/exit`
      ([[board-command-parity]]), so `/exit` is now Claude Code's and forwards to the agent. Watch the
      session list and active pane. Screenshot the tab list + pane before typing and after Enter settles.
      Then confirm resumability: the same tab now shows a relaunch panel — click it and watch the session
      come back online on the SAME conversation. (v0.3.0 respelled this stop verb `/exit`→`/stop`; the
      scenario id keeps its `exit` name as a stable anchor.)
    expected: |
      The session is STOPPED but NOT removed: its row STAYS in the list (it does not drop off), now reading
      `offline`, and the active tab swaps the live terminal for the relaunch panel — the same offline+relaunch
      a crash would produce — with NO confirmation prompt (typing the exact command IS the deliberate act). The
      view does NOT jump to New Session (no tab removal). Clicking relaunch `--resume`s the same conversation
      (the transcript survives). The literal text `/stop` is never dispatched into the terminal/agent (the
      read-only pane shows no new `/stop` line). Any other text, including `/stop` with trailing words,
      dispatches normally to the agent.
  - name: close-command-removes
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) on a LIVE
      (non-offline) session whose `❯` box is enabled. Type exactly `/close` into the box (dismiss the `/`
      completion menu if it opened, so Enter dispatches rather than completes) and press Enter. Watch the
      session list and active pane. Screenshot the tab list + pane before typing and after Enter settles.
    expected: |
      The session is REMOVED outright — its row drops off the list and the view lands on New Session, the same
      worktree removal the row-menu Close performs — but with NO confirmation prompt (typing the exact command
      IS the deliberate confirmation; the right-click Close still confirms, the typed command does not). The
      literal text `/close` is never dispatched into the terminal/agent (the read-only pane shows no new
      `/close` line). Any other text, including `/close` with trailing words, dispatches normally to the agent.
  - name: window-bounded-scroll
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, with MORE live/queued sessions than fit the
      viewport at once (a dozen or more), look at the top-left SessionWindow glance together with the
      bottom-left `.graph-stats` strip (v0.3.0 renamed the board glance's stats strip board→graph). Measure
      three things from a full-board screenshot: (a) the
      window's rendered height against the viewport height, (b) whether the window's bottom edge stays
      ABOVE the stats strip with a gap (they never overlap), and (c) that the rows past the cap are
      reachable — wheel/drag the scrollbar inside the window down to its end and screenshot the last
      row in view. Compare against the pre-change baseline (the MAIN dashboard) where the same long
      list grows unbounded.
    expected: |
      The SessionWindow is a bounded glance: its height is capped at ~80% of the viewport and it always
      stops short of the bottom stats strip, so the strip's chips stay fully visible and clickable — the
      window never covers them. The overflow is not lost: a vertical scrollbar appears inside the window
      and scrolling reaches the final row. On the MAIN baseline the same long list extends straight down
      past 80% of the viewport and overlaps/covers the stats strip, with no scrollbar.
  - name: board-command-parity
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) on a session in the
      REVIEW state (so type + merge apply). (1) Read the tab bar: on the LEFT two tabs — Terminal (default) and
      Eval; on the RIGHT the action row shows two small TEXT buttons — type, merge — with NO leading glyph/emoji
      (no ⌨ keyboard, no ◆ diamond), each in a distinct colour, and NO eval button (the eval is a TAB, not an
      action) — and the word "proof" appears nowhere in the UI. (2) On the Terminal tab, in the `❯` inbox type
      `/` and read the completion menu: the board's own
      commands (`/type`, `/eval`, `/merge`, `/stop`, `/close`) lead the list, each `/name` and its `[ui]` tag
      painted its identity colour, visibly apart from Claude Code's blue command rows. Now narrow the query —
      type `/stop`, the board's muted-grey stop verb (v0.3.0 respelled it from `/exit`): confirm the menu shows
      `/stop` exactly ONCE (the board's coloured row). Then type `/exit`, a name Claude Code ships that the board
      no longer owns: confirm it shows only as CC's own blue built-in row. Each row's description reads as a
      sentence (first letter capitalised, e.g. "Stop — kill the agent…", not "stop — …").
      (3) Type `/eval` and Enter: the view switches to the Eval tab and the evaluation renders inline — identical
      to clicking the Eval tab; switch back to Terminal and click the Eval tab to confirm the SAME inline
      view. (4) Type `/type` and Enter: type mode engages (the `❯` box becomes the type-mode indicator AND the type
      button shows its active `.on` state); click the type button to toggle it back off. Screenshot the tab bar
      and the `/` menu.
    expected: |
      The action-row buttons are text-only (no glyphs/emoji) and colour-coded — type yellow (var --yellow =
      rgb(181,137,0)) and merge green (var --green = rgb(133,153,0)); there is NO eval button — Eval is a
      permanent TAB (blue underline when active), always available, not a review-gated action — and no UI
      surface says "proof" (the tab, the command, and its menu description all say eval).
      In the `/` menu the five board commands lead, each name + `[ui]` tag in its identity colour — the
      SAME hue as its button where it has one (type yellow, merge green), with `/eval` still cyan (var --cyan =
      rgb(42,161,152)) even though it now drives a TAB, not a button; the two button-less terminal verbs split
      by destructiveness — stop muted grey (var --muted = rgb(147,161,161), the dormant/offline hue it sends the
      session to) and close red (var --red = rgb(220,50,47), the worktree removal) — while CC's commands stay
      blue (rgb(38,139,210)); one element, one colour in both places. The board's `/stop` appears exactly ONCE as
      its coloured row; `/exit` — the pre-v0.3.0 spelling the board no longer owns after the `/exit`→`/stop`
      respelling — now shows only as CC's own blue built-in row (the override still filters a same-named CC twin,
      but no board command currently collides with a CC name) —
      and every row's description reads as a capitalised sentence. Typing `/eval` switches to the Eval tab and
      shows the same inline view the tab click does (one shared tab-state); typing `/type` toggles type mode
      exactly as the type button does, and the button reflects that same state. A board command is never
      dispatched to the agent — its line is intercepted and the draft cleared — so no `/eval`/`/type` text reaches the pane.
  - name: status-word-colour
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, with live sessions in DIFFERENT states, look at the
      top-left SessionWindow glance. Each row's status carrier is coloured from the single STATUS_COLOR map:
      in the compact glance that carrier is the `.sess-glyph` mark (`STATUS_GLYPH[status]`, the status WORD
      kept in its `title`/`aria-label`); the expanded row draws the word itself as `.sess-status`. Both read
      the SAME `STATUS_COLOR[status]`, so read the carrier's computed `color` per row (glyph in the compact
      glance, word when expanded) and compare against the pre-change baseline (the MAIN dashboard, one muted
      grey for all). Screenshot the SessionWindow so the per-bucket contrast is visible.
    expected: |
      Each status carrier is painted by its bucket hue from the single STATUS_COLOR map — four buckets only:
      `working` and `parked` green (var --green = rgb(133,153,0)); the waiting-on-you states
      `asking`/`review`/`done` yellow (var --yellow = rgb(181,137,0)); `error` red; and the dormant rest
      (`idle`/`starting`/`queued`/`close-pending`/`offline`) muted grey (rgb(147,161,161)). The compact
      glyph and the expanded word are ONE source: `.sess-glyph` and `.sess-status` both take
      `STATUS_COLOR[status]`, so a bucket reads the same hue whichever renders. On the MAIN baseline every
      carrier is that same muted grey regardless of state. The carrier's colour equals the session's
      liveness-dot colour on the surfaces that draw a dot (same source), and `working` green matches the
      avatar's liveness ring — dot, glyph/word, and ring never disagree.
  - name: nav-mode-modifier-combos-reach-the-terminal
    tags: [frontend-e2e, desktop]
    description: >
      Measure type mode's raw-key channel end to end. Stand up a live tmux pane running a key-echo program
      that renders control bytes visibly (`cat -v`), then exercise the REAL product path the dashboard
      uses — `POST /api/sessions/:id/input` with `{kind:'keys', keys:[<token>]}` (the same body sendRawKey
      posts; v0.3.0's session domain merged the old `/rawkey` into `/input {kind}`) — for the tokens
      typeKeyToken produces: a control combo `C-r`, a meta combo `M-b`, the named modified key `S-Tab`, a
      meta-uppercase `M-B`, a shift-arrow `S-Up`, an interrupt `C-c`, and a malformed `C-C-x`. After each,
      capture the pane to read what the program actually received. (Browser variant: open the console on a
      live session, enter type mode, press ⌃R / ⌥B / Shift+Tab and watch the agent's TUI respond.)
    expected: |
      Each modifier combo arrives as the correct terminal bytes — `C-r` → `^R` (0x12), `M-b` → `ESC b`,
      `S-Tab` → the back-tab `^[[Z` (what Claude Code's mode-cycle reads), `M-B` → `ESC B`, `S-Up` →
      `^[[1;2A`, `C-c` → 0x03 (interrupts the program). tmux accepts every encoded token; a malformed
      token is rejected (HTTP 404 / `ok:false`), never sent as junk. Type mode can therefore drive Claude
      Code's modifier bindings, not just arrows.
    code: spec-cli/src/sessions.ts, spec-cli/src/index.ts
  - name: nav-mode-alt-i-and-cmd-i-stay-reserved
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface on a LIVE session and
      confirm the reserved-toggle contract. Intercept `/api/sessions/:id/input` (the `kind:'keys'` channel —
      v0.3.0 renamed the old `/rawkey` route into it) so no keystroke can reach a real agent,
      recording only WHICH keys attempt a forward. With type mode OFF, press ⌥+I (Option+I — note ⌥I emits a
      dead-key glyph on a mac, so this also proves the e.code match) then ⌘+I; then enter type mode and
      press an ordinary key (`x`); then ⌥+I again. Then, with type mode OFF, press ⌥+⌘+I (all three keys
      held together — the browser's own devtools chord) and confirm the app does NOT toggle type mode and
      does NOT preventDefault it. Watch the bottom-bar type-mode indicator and the recorded forwards.
    expected: |
      ⌥+I and ⌘+I (a SINGLE modifier + I) toggle type mode on and off every time (the bottom-bar type-mode
      indicator appears/disappears) and forward NOTHING — no `/input` keys attempt is recorded for either. An
      ordinary key pressed while type mode is ON DOES forward (recorded), so the carve-out is exactly the two
      reserved chords, not a blanket block. ⌥+⌘+I held TOGETHER is left alone: the type-mode indicator does not
      change and the app does not cancel the event, so the browser's devtools accelerator opens normally
      (the two-modifier chord is the browser's, not the app's). The browser/app takes no other action on
      ⌥/⌘+I.
  - name: type-mode-esc-always-forwards-never-exits
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface on a LIVE session and
      enter type mode (⌥/⌘+I or the type button). Intercept `/api/sessions/:id/input` (the `kind:'keys'`
      channel — v0.3.0 renamed the old `/rawkey` route into it) so no keystroke reaches a real agent,
      recording WHICH keys attempt a forward. Press Esc once, then press Esc twice in rapid succession
      (well under a second apart — the cadence that used to be the double-Esc exit), then a third burst of
      several fast Escs. After each burst read the bottom-bar type-mode indicator and the recorded forwards.
      Finally exit via ⌥/⌘+I (or the click) to confirm the sanctioned exits still work.
    expected: |
      Every Esc press — single, paired, or rapid-fire — forwards to the pane as an `/input` Escape and
      type mode STAYS ON: the bottom-bar indicator never disappears on any Esc cadence, because Esc belongs
      to the agent's own menus and a human cancelling something in the terminal must never be bounced out of
      the mode. There is no double-Esc exit. Type mode leaves only by the reserved ⌥/⌘+I toggle, the type
      button/indicator click, `/type`, switching tabs, or the session going offline.
  - name: modifier-arrow-switches-regardless-of-focus
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) with at least
      three live sessions so the tab list has several rows. Exercise the modifier switch from the states
      where a PLAIN arrow would NOT switch the tab: (1) caret parked in the middle of a multi-line draft in
      the New Session prompt; (2) on a live session with the `❯` inbox focused mid-text; (3) in type mode (so
      plain keys forward raw to the pane). From each, press ⌘+↓
      (or ⌥+↓) then ⌘+↑ (or ⌥+↑) and read which tab is selected after each. Separately, from any tab press
      ⌥+N (Option+N — note ⌥N emits a dead-key `˜` glyph on a mac, so this also proves the e.code match) and
      read the selection. Finally, test the input box's stability against PLAIN arrows: with the New prompt (or
      a live `❯` box) focused, put the caret on its FIRST line and press a plain ↑, then on its LAST line and
      press a plain ↓, and read whether the selected tab moved. Screenshot the tab list before and after each press.
    expected: |
      ⌘/⌥/⌃+↑/↓ ALWAYS step the selected tab one row up/down the session list, no matter which input holds
      focus — mid-word in a textarea or while type mode forwards raw keys — and the
      modifier never moves the textarea caret nor reaches the agent's pane instead. ⌥/⌘+↑ no longer jumps to
      New Session; it simply steps up the list. ⌥+N snaps the selection to
      New Session from any tab, type mode included — ⌘+N (mac) / ⌃+N (win/linux) are the browser's
      reserved new-window chord a web page can't cancel, so they are not claimed. A plain ↑/↓ pressed inside a
      text input NEVER switches tabs — at the first line a plain ↑ and at the last line a plain ↓ both stay in
      the box (caret keys only), so typing never jerks the selection; plain ↑/↓ walk the list only when focus is
      outside any text input.
  - name: input-grows-no-premature-scrollbar
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, on the New Session prompt (the `.si-input` textarea),
      type and grow the box line by line: paste/enter ONE line, then TWO, then keep adding newlines well past
      the resting single row but still BELOW the CSS cap (max-height 180px ≈ 9 lines), then finally enough
      lines to EXCEED the cap. After each step let the .12s height transition settle, then screenshot the box.
      Watch specifically for a vertical scrollbar (and any 1px scroll jiggle) on the textarea while its
      rendered height is still under the cap. Compare against the MAIN baseline where `.si-input` carried
      `overflow-y: auto` unconditionally.
    expected: |
      Below the cap the box is exactly as tall as its content and shows NO scrollbar — not at rest, not mid-
      grow, not as a sub-pixel flicker — because overflow-y stays `hidden` until content actually exceeds the
      180px cap. Only once the content passes the cap does the height stop at 180px and a vertical scrollbar
      appear (overflow-y flips to `auto`), and scrolling reaches the last line. The same holds for the docked
      `❯` inbox against its half-terminal cap. On the MAIN baseline a scrollbar can show below the cap (a
      transient flash during the grow transition, or a persistent bar from scrollHeight sub-pixel rounding).
  - name: input-dock-reserves-bottom-strip
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) on a LIVE session
      whose tmux pane paints a bottom status line (a running agent's own status bar, or a full-screen TUI
      like `htop`/`vim` whose last row is a status line). At the RESTING single-line `❯` box, read the
      geometry: the bounding rects of the terminal region (`.si-term-body`) and the docked input
      (`.si-bottom`), and check whether the terminal's bottom edge sits AT OR ABOVE the input's top edge
      (no overlap). Screenshot to confirm the pane's bottom status line is fully visible, not covered by the
      input. Then grow the box multi-line (paste several newlines, staying below the half-terminal cap) and
      RE-READ `.si-term-body`'s bounding rect + screenshot. Compare against the pre-change MAIN baseline where
      the input floats over the terminal's bottom.
    expected: |
      At rest the terminal ENDS ABOVE the input: `.si-term-body`'s bottom edge is at or above `.si-bottom`'s
      top edge (they abut, never overlap), so the pane's own bottom status line stays fully visible — the
      resting input never covers it. Growing the box multi-line does NOT move the terminal: `.si-term-body`'s
      bounding rect is unchanged between the resting and grown states (terminal content is not pushed up); the
      taller input instead OVERLAYS the terminal's lower edge, its opaque panel occluding those lines while
      they scroll behind it. On the MAIN baseline the resting input floats over the terminal and hides its
      bottom status line.
    related: spec-dashboard/src/styles.css
  - name: dock-prompt-stays-on-active-line
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) on a LIVE session and
      focus the docked `❯` box. At REST (single line) read the bounding rects of the prompt (`.si-prompt`), the
      textarea (`.si-input`) and the paperclip (`.si-attach`) and confirm the three align on the one line. Then
      grow the box multi-line (paste several newlines, below the half-terminal cap) and RE-READ the `❯` prompt's
      rect against the box (`.si-bottom`): where does `❯` sit vertically — on the bottom (active) line where the
      caret is, or floating in the box's vertical middle? Screenshot the grown box.
    expected: |
      The `❯` prompt and the paperclip stay pinned to the BOTTOM line of the box in every state (`.si-bottom` is
      `align-items: flex-end`). At rest the single line's three controls align. As the box grows UPWARD, `❯`
      tracks the active bottom line — the line the caret is on — never drifting to the vertical centre. A `❯`
      floating mid-box, beside an inert middle line, is the bug (the `align-items: center` regression).
    related: spec-dashboard/src/styles.css
  - name: dock-rest-line-vertically-centred
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) on a LIVE session
      and look at the docked `❯` box AT REST (empty, single line). Read the bounding rects of the box
      (`.si-bottom`) and the prompt/input row (`.si-prompt`, `.si-input`) and compute the two gaps: row top
      to box top, and box bottom to row bottom. Then grow the draft multi-line (below the cap) and re-read
      the prompt's position to confirm the growth contract still holds. Screenshot the resting strip.
    expected: |
      At rest the single line sits in the VERTICAL CENTRE of the 44px strip: the gap above the `❯`/text row
      equals the gap below it (within a pixel) — the resting box is exactly filled, so the deliberate
      `align-items: flex-end` has nothing to push against. A row visibly low in the strip (top gap ≫ bottom
      gap, e.g. 17px vs 7px) is the bug. Growing the box multi-line is UNCHANGED by this contract: `❯` and
      the paperclip still track the active bottom line ([[dock-prompt-stays-on-active-line]]), never the
      box's vertical middle.
    related: spec-dashboard/src/styles.css
  - name: inbox-mention-dropdown-and-resolution
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) on a LIVE
      (non-offline) session and put focus in its docked `❯` inbox (NOT the New Session prompt). Type `[[`
      followed by a partial node id (e.g. `[[term`). Watch for the spec-node completion dropdown to open
      ABOVE the box (`.si-bottom .mention-menu.up`), ranked the same as New's `[[` menu (focused node first,
      then prefix matches). Arrow/Enter to accept the top row and confirm the token `[[<id>]]` is INSERTED
      into the inbox draft (not sent, terminal unchanged, menu closes). Then confirm the send-time resolution
      WITHOUT disturbing a real worker: against the live spec index, `look at [[term-input]]` must transform
      to `look at [[term-input]] (<path-to-term-input/spec.md>)`; an unknown id passes through. ([[mentions]]:
      `[[node]]` is a topic; `@` is now reserved for actor mentions.) Compare against the MAIN baseline, where
      the inbox has NO node menu and the ref is sent verbatim.
    expected: |
      The exact same `[[` dropdown the New Session prompt offers also opens in a running session's `❯` inbox —
      one shared menu, not a second implementation — opening upward, ranked focused-node-first. Accepting a
      row inserts `[[<id>]] ` into the inbox draft only (never dispatched on pick, terminal shows no new line),
      and the menu closes. On send, each `[[<id>]]` resolves in place to `[[<id>]] (<spec.md path>)` — the live
      pointer the driven agent opens, mirroring spec-pointer's launch pointer — while an unknown id and the
      surrounding prose are sent verbatim. On the MAIN baseline none of this exists: the inbox has no node
      menu and forwards the ref literally.
    related: spec-dashboard/src/SessionInterface.jsx
  - name: terminal-proof-tabs
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) on a LIVE session.
      The right pane is a two-tab view: a horizontal tab bar (Terminal | Eval — the former Proof tab, which
      [[session-eval]] folded into the session Eval; the proof HTML lives on as that tab's export ↗ link)
      above the pane content. Confirm the DEFAULT tab is Terminal — the live terminal shows and the docked `❯`
      input is present below it. Read the tab bar's computed background against the terminal's (`.si-tabbar`
      vs `.si-term-body`) to confirm they differ (a distinct panel + a bottom separator), and repeat in BOTH
      light and dark themes. Then click the Eval tab: confirm the terminal is hidden (display:none) but NOT
      unmounted (the `.si-term-body` node stays in the DOM so its socket/scroll survive), the `❯` input dock
      is gone (input belongs to Terminal only), and the session's eval view renders INLINE — never a floating
      overlay. Switch back to Terminal and confirm the live pane is intact. Then the grown-input round-trip:
      on Terminal, grow the `❯` box multi-line (a several-line draft, unsent), read its rendered height,
      switch to the other tab and back, and re-read the box's height and draft. Screenshot the tab bar + pane
      on each tab, plus the grown box before and after the round-trip.
    expected: |
      The right pane opens on the Terminal tab by default: the live terminal is visible with the docked `❯`
      input below it. The tab bar is a clear horizontal row set VISIBLY APART from the dark terminal — a lighter
      app-chrome panel (var --panel) with a bottom separator (var --line), distinct from the terminal's var
      --term-bg in BOTH light (#f4eeda vs #0d1117) and dark (#161b22 vs #0d1117) themes. Clicking Eval hides the
      terminal (display:none) without unmounting it — `.si-term-body` and its terminal layers stay in the DOM so
      the socket and scrollback survive a round-trip — drops the `❯` input dock, and renders the session eval
      INLINE in the pane (the eval feed of the session's work, carrying the proof export ↗ link), not a modal
      overlay. Returning to Terminal restores the live pane unchanged. The Eval tab is always available for any
      selected session, not only one in review. The grown `❯` box survives the round-trip: its multi-line draft
      is still there AND its rendered height matches the pre-switch height (re-fit to the persisted draft on
      remount) — it is never collapsed back to a single row.
    related: spec-dashboard/src/SessionEval.jsx
  - name: eval-tab-folds-session-list
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) on a LIVE session so
      the right pane shows the Terminal|Eval tab bar and the left session list (`.si-list`) is at its full
      width. Read the left column geometry on the Terminal tab: `.si-list` is present with its top button row +
      session rows, and the drag divider (`.si-resizer`) sits on its border. Now click the Eval tab and re-read
      the left column: measure `.si-list`'s rendered width/visibility and whether a thin unfold strip
      (`.si-list-unfold`, ~22px, the Evals page's `.fv-unfold` twin) has taken its place, with the resizer gone.
      Click that strip and confirm the full list returns while STILL on the Eval tab (a manual unfold sticks).
      Then, from the folded state again (re-enter Eval), switch back to the Terminal tab and confirm the full
      list is restored automatically. Screenshot the left column on the Terminal tab, on the Eval tab (folded),
      and after the manual unfold.
    expected: |
      Opening the Eval tab auto-collapses the session list to a thin strip: `.si-list` is no longer taking its
      full ~240px width (it is display:none, still in the DOM so its zone/nesting/selection state survives), and
      in its place sits the slim `.si-list-unfold` strip (~22px, the same fold-to-strip geometry the Evals page's
      master list uses) with the `.si-resizer` drag divider removed — the eval master-detail owns the width.
      Clicking the strip brings the full session list back while the Eval tab is still shown, and it stays
      unfolded (the manual unfold sticks; it only re-folds on a fresh entry to the tab). Switching back to the
      Terminal tab restores the full session list automatically. On the MAIN baseline the session list keeps its
      full width on the Eval tab — there is no fold.
    related: spec-dashboard/src/SessionInterface.jsx
  - name: eval-return-no-terminal-reflow
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface on a LIVE session whose pane
      is a NORMAL-screen program — a shell or a codex-style inline TUI on the main screen (NOT an
      alternate-screen full-screen TUI like Claude Code) — with real scrollback below the fold. Instrument the
      terminal WebSocket to log every OUTGOING `{t:'resize'}` frame. On the Terminal tab, let the pane settle
      and note its visible bottom content. Now do the round-trip the list-fold makes lossy: click Eval (which
      folds the session list to a strip, [[eval-tab-folds-session-list]]) and then click straight back to
      Terminal. Collect the resize frames emitted DURING that round-trip and the pane's visible content right
      after returning and once settled. Screenshot the pane on the Terminal tab BEFORE the round-trip and just
      after returning.
    expected: |
      A Terminal→Eval→Terminal round-trip sends ZERO resize frames to the pane — the terminal's column count is
      identical before and after — so tmux never reflows the pane and a normal-screen (codex) program receives
      no SIGWINCH. The pane comes back showing exactly its prior bottom content, in place, with no re-render: it
      does NOT re-seed from high in its scrollback and animate downward to the live bottom. The bug path — the
      list unfold restoring on a LAGGING effect one frame after the tab flips, so the pane paints one frame at
      the wide (list-folded) width and then snaps to the narrow (list-shown) width, firing two resizes (wide
      then narrow) that reflow a normal-screen pane into a scroll-through-history redraw (an alternate-screen
      pane redraws in place and hides it) — must be absent: the list is never folded while the Terminal tab
      shows, so the terminal width is stable across the round-trip and no resize is emitted.
    related: spec-dashboard/src/SessionInterface.jsx
  - name: launcher-picker-opens-on-click
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, with the project configured with named launchers
      ([[launcher-select]]) so the New-Session composer shows the launcher `<select>` (`.si-launcher-select`)
      in place of the harness radios. Open the New Session tab and dispatch a REAL pointer mousedown at the
      centre of the select (not a programmatic `selectOption`, which bypasses the mousedown path that is the
      whole bug). A native `<select>` opens its dropdown ON the mousedown default action, so the measurable
      fingerprint is whether the panel-level focus-retention handler (`keepFocus`) cancels that default:
      attach a one-shot `mousedown` listener on the select, dispatch the pointer, and read the event's
      `defaultPrevented` after the bubbling panel handler has run. Corroborate that the control is
      pointer-interactable (its value changes) and screenshot the composer.
    expected: |
      The mousedown's `defaultPrevented` is FALSE — the composer's focus retention no longer cancels the
      select's default action, so the native launcher dropdown opens on a real click and the picker is
      operable by the pointer (its value follows the chosen option). Focus retention still blankets the
      inert chrome; it just spares native form controls (`<select>`/`<option>`) that own their own
      mousedown. Regression guard: with the `keepFocus` select exemption removed, the same measurement
      reads `defaultPrevented` TRUE and the dropdown never opens.
  - name: launcher-picker-shows-harness-icon
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, with the project configured with at least two named
      launchers whose harnesses DIFFER ([[launcher-select]]) — e.g. one `claude` launcher and one `codex`
      launcher — so the New-Session composer shows the launcher `<select>` (`.si-launcher-select`). Open the
      New Session tab. First read the option text: the `<option>`s show ONLY the launcher name, with NO
      ` · claude`/` · codex` harness text suffix. Then read the harness adornment beside the select
      (`.si-launcher-harness svg`) and confirm it renders an inline-SVG vendor glyph (the same mark the
      harness radios use — Anthropic for a claude launcher, OpenAI for a codex launcher), NOT text. With a
      claude-harness launcher selected, note WHICH glyph shows (its path `d`, or the wrapper's `title`); then
      change the selection to the codex-harness launcher and RE-READ the adornment. Screenshot the composer on
      each selection.
    expected: |
      The `<option>` labels carry the launcher name alone — no ` · claude`/` · codex` text suffix. Beside the
      select sits a single small inline-SVG harness glyph (`.si-launcher-harness svg`), never a text harness
      label: it reflects the SELECTED launcher's harness — the Anthropic mark for a claude launcher, the
      OpenAI mark for a codex launcher (the SAME vendor glyphs the icon-only harness radios use). Changing the
      selection to a launcher on the other harness SWAPS the glyph to that harness's mark (the `title` and the
      SVG path change), so the icon always tracks the current selection. The native `<select>` still opens and
      operates on click (the launcher-picker-opens-on-click contract is unaffected).
    related: spec-dashboard/src/SessionInterface.jsx
  - name: tab-dblclick-locks-graph
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface (#/sessions) with at
      least two sessions available: one WITH pending ops (its tab carries the ops tooltip / op tally) and
      one WITHOUT any pending ops (a freshly dispatched worker, or one whose spec edits are already
      committed — the common resting state). Double-click each tab in turn (expanding any nesting fold
      first so the tab is visible). After each double-click, read `location.hash`, whether the graph page
      is the visible page, and whether the session-lock banner (`.lock-hint`) is up. Record the whole
      interaction as a video.
    expected: |
      BOTH double-clicks leave the console and land on the graph page (`#/graph`) with the board LOCKED
      onto that session (the lock banner is up; rest of the board greys where overlays exist). The
      with-ops session additionally auto-focuses its first changed node. The ops-less session still
      locks — the banner explains the empty grip ([[keyboard-nav]]'s lock contract: "a no-overlay session
      still locks") — it is NEVER a silent no-op that leaves you sitting on the sessions page. Single
      click still only switches tabs; the double-click gesture is the console-side twin of the board
      window's single-click lock, with no pending-ops precondition.
    related: spec-dashboard/src/SessionInterface.jsx
  - name: ime-enter-composes-not-sends
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) on the New Session
      prompt (the same Enter-to-dispatch input the running session's `❯` inbox shares). Focus the box and type
      pinyin letters as an IME shows them mid-composition (e.g. `nihao`). Then fire the Enter that COMMITS the
      IME composition — a keydown carrying the browser's compose flag (`isComposing = true` / keyCode 229),
      which pinyin/かな/한글 IMEs emit when you press Enter to pick a candidate. Intercept `POST /api/sessions`
      to see whether a launch was dispatched (fulfil it locally so no real worker spawns). Then press a NORMAL
      Enter (isComposing = false) and confirm the now-composed line dispatches. Record the run as video.
    expected: |
      The IME-committing Enter (isComposing) COMPOSES only — the box KEEPS its text and NO `POST /api/sessions`
      fires: pressing Enter to choose a pinyin candidate must never dispatch the line. Only the following real
      Enter (not composing) submits — the box clears and exactly one launch POST fires. The same guard holds
      for a running session's `❯` inbox (sendMsg) and the completion-menu Enter/Tab accept: an Enter that ends
      an IME composition is swallowed by the compose, never read as send. Baseline bug: the IME Enter cleared
      the box and fired the launch POST, sending the half-composed word instead of composing it.
    code: spec-dashboard/src/SessionInterface.jsx
  - name: filer-chip-opens-console
    tags: [frontend-e2e]
    code: spec-dashboard/src/SessionInterface.jsx
    related: [spec-dashboard/src/SessionEval.jsx, spec-dashboard/src/EventDetail.jsx]
    description: >-
      On a session's Eval tab, select a reading THAT SESSION filed (the header's filer chip names the
      session you are already viewing) and click the live filer chip. Read the right pane's tab state and
      the hash before and after. Then, on an eval whose filer is a DIFFERENT live session, click its chip.
    expected: >-
      The chip is never a dead button. Clicking the filer chip of the session you are already viewing flips
      the right pane to the TERMINAL tab (the console — "open this session" made real; the hash may stay
      put since the session is already selected). Clicking a different live session's chip navigates to
      #/sessions/<id> and lands on that session's console. Baseline bug: same-session clicks did nothing —
      setSessionSel was already set and navigate() saw an identical hash, so the openable chip was a no-op.
---

# session-console — yatsu

Measure through the **real dashboard surface**, YATU-style: drive the actual browser interface (open with
`Enter`, click the tabs, and close via the **session row's right-click menu → Close → confirm** — there is no
header close button), never a direct `/api/sessions/:id/close` call or an internal selection helper. The loss
being scored is the **selection contract** in the spec. Two halves. (1) **Creating never moves you**: submitting
a New Session launch keeps you on the New tab (prompt cleared) so you can fire off several in a row — the new
session only appears as a row below, never as a tab the view jumps onto. (2) The **tab-fallback** on removal: a
closed session leaves the board, and that **removal** — not the closing gesture — is what decides where you
land. You are still on the closed tab → New Session; you already moved to another valid tab → your switch
stands. Evidence is a before/after screenshot pair of the tab list and active pane for each pass.
