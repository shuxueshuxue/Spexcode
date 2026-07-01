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
      close-tab-fallback scenarios — note `/exit` does NOT remove a tab, it only stops the session), never a
      creation.
  - name: exit-command-stops-keeps-worktree
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) on a LIVE
      (non-offline) session whose `❯` box is enabled. Type exactly `/exit` into the box (dismiss the `/`
      completion menu if it opened, so Enter dispatches rather than completes) and press Enter. Watch the
      session list and active pane. Screenshot the tab list + pane before typing and after Enter settles.
      Then confirm resumability: the same tab now shows a relaunch panel — click it and watch the session
      come back online on the SAME conversation.
    expected: |
      The session is STOPPED but NOT removed: its row STAYS in the list (it does not drop off), now reading
      `offline`, and the active tab swaps the live terminal for the relaunch panel — the same offline+relaunch
      a crash would produce — with NO confirmation prompt (typing the exact command IS the deliberate act). The
      view does NOT jump to New Session (no tab removal). Clicking relaunch `--resume`s the same conversation
      (the transcript survives). The literal text `/exit` is never dispatched into the terminal/agent (the
      read-only pane shows no new `/exit` line). Any other text, including `/exit` with trailing words,
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
      bottom-left `.board-stats` strip. Measure three things from a full-board screenshot: (a) the
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
      REVIEW state (so nav + merge apply). (1) Read the tab bar: on the LEFT two tabs — Terminal (default) and
      Proof; on the RIGHT the action row shows two small TEXT buttons — nav, merge — with NO leading glyph/emoji
      (no ⌨ keyboard, no ◆ diamond), each in a distinct colour, and NO "proof" button (proof is a TAB now, not an
      action). (2) On the Terminal tab, in the `❯` inbox type `/` and read the completion menu: the board's own
      commands (`/nav`, `/proof`, `/merge`, `/exit`, `/close`) lead the list, each `/name` and its `[board]` tag
      painted its identity colour, visibly apart from Claude Code's blue command rows. Now narrow the query —
      type `/exit`, a name Claude Code ALSO ships: confirm the menu shows `/exit` exactly ONCE (the board's
      coloured row), not a duplicate pair, and that each row's description reads as a sentence (first letter
      capitalised, e.g. "Exit — stop the agent…", not "exit — …").
      (3) Type `/proof` and Enter: the view switches to the Proof tab and the proof renders inline — identical
      to clicking the Proof tab; switch back to Terminal and click the Proof tab to confirm the SAME inline
      proof. (4) Type `/nav` and Enter: nav mode engages (the `❯` box becomes the nav indicator AND the nav
      button shows its active `.on` state); click the nav button to toggle it back off. Screenshot the tab bar
      and the `/` menu.
    expected: |
      The action-row buttons are text-only (no glyphs/emoji) and colour-coded — nav yellow (var --yellow =
      rgb(181,137,0)) and merge green (var --green = rgb(133,153,0)); there is NO proof button — Proof is a
      permanent TAB (blue underline when active), always available, not a review-gated action.
      In the `/` menu the five board commands lead, each name + `[board]` tag in its identity colour — the
      SAME hue as its button where it has one (nav yellow, merge green), with `/proof` still cyan (var --cyan =
      rgb(42,161,152)) even though it now drives a TAB, not a button; the two button-less terminal verbs split
      by destructiveness — exit muted grey (var --muted = rgb(147,161,161), the dormant/offline hue it sends the
      session to) and close red (var --red = rgb(220,50,47), the worktree removal) — while CC's commands stay
      blue (rgb(38,139,210)); one element, one colour in both places. A name the board owns that Claude Code
      also ships (`/exit`) appears exactly ONCE — the board's row overrides CC's twin, never a duplicate pair —
      and every row's description reads as a capitalised sentence. Typing `/proof` switches to the Proof tab and
      shows the same inline proof the tab click does (one shared tab-state); typing `/nav` toggles nav mode
      exactly as the nav button does, and the button reflects that same state. A board command is never
      dispatched to the agent — its line is intercepted and the draft cleared — so no `/proof`/`/nav` text reaches the pane.
  - name: status-word-colour
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, with several live sessions in DIFFERENT states (at
      minimum a `working`, an `asking`, and a `close-pending`), look at the top-left SessionWindow glance.
      For each row read the status word's RENDERED colour (computed `color`), not just its text, and compare
      against the pre-change baseline (the MAIN dashboard, where every status word is the same muted grey).
      Screenshot the SessionWindow on both so the contrast is visible.
    expected: |
      On the changed dashboard each status word is painted by its bucket hue from the single STATUS_COLOR
      map — four hues only: `working` and `parked` green (var --green = rgb(133,153,0)); the waiting-on-you
      states `asking`/`review`/`done` yellow (var --yellow = rgb(181,137,0)); `error` red; and the dormant
      rest (`idle`/`starting`/`queued`/`close-pending`/`offline`) muted grey (rgb(147,161,161)). On the
      MAIN baseline every word is that same muted grey regardless of state. The word's colour equals the
      session's liveness-dot colour on the surfaces that draw a dot (same source), and `working` green
      matches the avatar's liveness ring — dot, word, and ring never disagree.
  - name: nav-mode-modifier-combos-reach-the-terminal
    tags: [frontend-e2e, desktop]
    description: >
      Measure nav mode's raw-key channel end to end. Stand up a live tmux pane running a key-echo program
      that renders control bytes visibly (`cat -v`), then exercise the REAL product path the dashboard
      uses — `POST /api/sessions/:id/rawkey` with `{key}` (the same body sendRawKey posts) — for the tokens
      navKeyToken produces: a control combo `C-r`, a meta combo `M-b`, the named modified key `S-Tab`, a
      meta-uppercase `M-B`, a shift-arrow `S-Up`, an interrupt `C-c`, and a malformed `C-C-x`. After each,
      capture the pane to read what the program actually received. (Browser variant: open the console on a
      live session, enter nav mode, press ⌃R / ⌥B / Shift+Tab and watch the agent's TUI respond.)
    expected: |
      Each modifier combo arrives as the correct terminal bytes — `C-r` → `^R` (0x12), `M-b` → `ESC b`,
      `S-Tab` → the back-tab `^[[Z` (what Claude Code's mode-cycle reads), `M-B` → `ESC B`, `S-Up` →
      `^[[1;2A`, `C-c` → 0x03 (interrupts the program). tmux accepts every encoded token; a malformed
      token is rejected (HTTP 404 / `ok:false`), never sent as junk. Nav mode can therefore drive Claude
      Code's modifier bindings, not just arrows.
    code: spec-cli/src/sessions.ts, spec-cli/src/index.ts
  - name: nav-mode-alt-i-and-cmd-i-stay-reserved
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface on a LIVE session and
      confirm the reserved-toggle contract. Intercept `/rawkey` so no keystroke can reach a real agent,
      recording only WHICH keys attempt a forward. With nav mode OFF, press ⌥+I (Option+I — note ⌥I emits a
      dead-key glyph on a mac, so this also proves the e.code match) then ⌘+I; then enter nav mode and
      press an ordinary key (`x`); then ⌥+I again. Then, with nav mode OFF, press ⌥+⌘+I (all three keys
      held together — the browser's own devtools chord) and confirm the app does NOT toggle nav mode and
      does NOT preventDefault it. Watch the bottom-bar nav indicator and the recorded forwards.
    expected: |
      ⌥+I and ⌘+I (a SINGLE modifier + I) toggle nav mode on and off every time (the bottom-bar nav
      indicator appears/disappears) and forward NOTHING — no `/rawkey` attempt is recorded for either. An
      ordinary key pressed while nav mode is ON DOES forward (recorded), so the carve-out is exactly the two
      reserved chords, not a blanket block. ⌥+⌘+I held TOGETHER is left alone: the nav indicator does not
      change and the app does not cancel the event, so the browser's devtools accelerator opens normally
      (the two-modifier chord is the browser's, not the app's). The browser/app takes no other action on
      ⌥/⌘+I.
  - name: modifier-arrow-switches-regardless-of-focus
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) with at least
      three live sessions so the tab list has several rows. Exercise the modifier switch from the states
      where a PLAIN arrow would NOT switch the tab: (1) caret parked in the middle of a multi-line draft in
      the New Session prompt; (2) on a live session with the `❯` inbox focused mid-text; (3) in nav mode (so
      plain keys forward raw to the pane). From each, press ⌘+↓
      (or ⌥+↓) then ⌘+↑ (or ⌥+↑) and read which tab is selected after each. Separately, from any tab press
      ⌥+N (Option+N — note ⌥N emits a dead-key `˜` glyph on a mac, so this also proves the e.code match) and
      read the selection. Finally, test the input box's stability against PLAIN arrows: with the New prompt (or
      a live `❯` box) focused, put the caret on its FIRST line and press a plain ↑, then on its LAST line and
      press a plain ↓, and read whether the selected tab moved. Screenshot the tab list before and after each press.
    expected: |
      ⌘/⌥/⌃+↑/↓ ALWAYS step the selected tab one row up/down the session list, no matter which input holds
      focus — mid-word in a textarea or while nav mode forwards raw keys — and the
      modifier never moves the textarea caret nor reaches the agent's pane instead. ⌥/⌘+↑ no longer jumps to
      New Session; it simply steps up the list. ⌥+N snaps the selection to
      New Session from any tab, nav mode included — ⌘+N (mac) / ⌃+N (win/linux) are the browser's
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
  - name: inbox-mention-dropdown-and-resolution
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) on a LIVE
      (non-offline) session and put focus in its docked `❯` inbox (NOT the New Session prompt). Type `@`
      followed by a partial node id (e.g. `@term`). Watch for the spec-node completion dropdown to open
      ABOVE the box (`.si-bottom .mention-menu.up`), ranked the same as New's `@` menu (focused node first,
      then prefix matches). Arrow/Enter to accept the top row and confirm the token is INSERTED into the
      inbox draft (not sent, terminal unchanged, menu closes). Then confirm the send-time resolution
      WITHOUT disturbing a real worker: against the live spec index, the message `look at @term-input` must
      transform to `look at @term-input (<path-to-term-input/spec.md>)`; an unknown id passes through. Compare
      against the MAIN baseline, where the inbox has NO `@` menu and `@id` is sent verbatim.
    expected: |
      The exact same `@` dropdown the New Session prompt offers also opens in a running session's `❯` inbox —
      one shared menu, not a second implementation — opening upward, ranked focused-node-first. Accepting a
      row inserts `@<id> ` into the inbox draft only (never dispatched on pick, terminal shows no new line),
      and the menu closes. On send, each `@<id>` resolves in place to `@<id> (<spec.md path>)` — the live
      pointer the driven agent opens, mirroring spec-pointer's launch pointer — while an unknown id and the
      surrounding prose are sent verbatim. On the MAIN baseline none of this exists: the inbox has no `@`
      menu and forwards `@id` literally.
    related: spec-dashboard/src/SessionInterface.jsx
  - name: terminal-proof-tabs
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) on a LIVE session.
      The right pane is a two-tab view: a horizontal tab bar (Terminal | Proof) above the pane content. Confirm
      the DEFAULT tab is Terminal — the live terminal shows and the docked `❯` input is present below it. Read
      the tab bar's computed background against the terminal's (`.si-tabbar` vs `.si-term-body`) to confirm they
      differ (a distinct panel + a bottom separator), and repeat in BOTH light and dark themes. Then click the
      Proof tab: confirm the terminal is hidden (display:none) but NOT unmounted (the `.si-term-body` node stays
      in the DOM so its socket/scroll survive), the `❯` input dock is gone (input belongs to Terminal only), and
      the review proof renders INLINE in a `.proof-pane` (an `<iframe>` for a session with work, else a clean
      empty/loading placeholder) — never a floating overlay. Switch back to Terminal and confirm the live pane
      is intact. Screenshot the tab bar + pane on each tab.
    expected: |
      The right pane opens on the Terminal tab by default: the live terminal is visible with the docked `❯`
      input below it. The tab bar is a clear horizontal row set VISIBLY APART from the dark terminal — a lighter
      app-chrome panel (var --panel) with a bottom separator (var --line), distinct from the terminal's var
      --term-bg in BOTH light (#f4eeda vs #0d1117) and dark (#161b22 vs #0d1117) themes. Clicking Proof hides the
      terminal (display:none) without unmounting it — `.si-term-body` and its terminal layers stay in the DOM so
      the socket and scrollback survive a round-trip — drops the `❯` input dock, and renders the proof INLINE as
      a `.proof-pane` (the self-contained proof `<iframe>`, or the empty/loading placeholder when there is
      nothing to prove yet), not a modal overlay. Returning to Terminal restores the live pane unchanged. The
      proof is always available on this tab for any selected session, not only one in review.
    related: spec-dashboard/src/ReviewProof.jsx
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
