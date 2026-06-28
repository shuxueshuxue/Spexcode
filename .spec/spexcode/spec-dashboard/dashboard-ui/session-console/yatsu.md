---
scenarios:
  - name: close-tab-fallback
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) with at least
      two live sessions, A and B. Closing is reached ONLY by right-clicking a session row → "Close" →
      confirming the prompt (there is no header close button). First confirm the header carries no close
      control: with A selected, the action row shows only the state-driven buttons (nav, proof, relaunch/
      merge), never a "close"/kill button. Then two passes. PASS 1 — select A's tab, right-click A's row,
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
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) on a session in the
      REVIEW state (so nav + proof + merge all apply). (1) Read the header action row: confirm three small
      TEXT buttons — nav, proof, merge — with NO leading glyph/emoji (no ⌨ keyboard, no ◆ diamond), each
      rendered in a distinct colour. (2) In the `❯` inbox type `/` and read the completion menu: the board's
      own commands (`/nav`, `/proof`, `/merge`, `/exit`, `/close`) lead the list, each `/name` and its
      `[board]` tag painted its identity colour, visibly apart from Claude Code's blue command rows.
      (3) Type `/proof` and Enter: the proof overlay opens — identical to clicking the proof button; close it,
      then click the proof button and confirm the SAME overlay opens. (4) Type `/nav` and Enter: nav mode
      engages (the `❯` box becomes the nav indicator AND the nav button shows its active `.on` state); click
      the nav button to toggle it back off. Screenshot the action row and the `/` menu.
    expected: |
      The action-row buttons are text-only (no glyphs/emoji) and colour-coded — nav yellow (var --yellow =
      rgb(181,137,0)), proof cyan (var --cyan = rgb(42,161,152)), merge green (var --green = rgb(133,153,0)).
      In the `/` menu the five board commands lead, each name + `[board]` tag in its identity colour — the
      SAME hue as its button where it has one (nav yellow, proof cyan, merge green); the two button-less
      terminal verbs split by destructiveness — exit muted grey (var --muted = rgb(147,161,161), the dormant/
      offline hue it sends the session to) and close red (var --red = rgb(220,50,47), the worktree removal) —
      while CC's commands stay blue (rgb(38,139,210)); one element, one colour in both places. Typing `/proof` opens the
      very overlay the proof button opens (one shared open-state); typing `/nav` toggles nav mode exactly as
      the nav button does, and the button reflects that same state. A board command is never dispatched to the
      agent — its line is intercepted and the draft cleared — so no `/proof`/`/nav` text reaches the pane.
  - name: status-word-colour
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
    description: >
      Through the running dashboard in a real browser, open the session interface on a LIVE session and
      confirm the reserved-toggle contract. Intercept `/rawkey` so no keystroke can reach a real agent,
      recording only WHICH keys attempt a forward. With nav mode OFF, press ⌥+I (Option+I — note ⌥I emits a
      dead-key glyph on a mac, so this also proves the e.code match) then ⌘+I; then enter nav mode and
      press an ordinary key (`x`); then ⌥+I again. Watch the bottom-bar nav indicator and the recorded
      forwards.
    expected: |
      ⌥+I and ⌘+I toggle nav mode on and off every time (the bottom-bar nav indicator appears/disappears)
      and forward NOTHING — no `/rawkey` attempt is recorded for either. An ordinary key pressed while nav
      mode is ON DOES forward (recorded), so the carve-out is exactly the two reserved chords, not a blanket
      block. The browser/app takes no other action on ⌥/⌘+I.
  - name: modifier-arrow-switches-regardless-of-focus
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) with at least
      three live sessions so the tab list has several rows. Exercise the modifier switch from the states
      where a PLAIN arrow would NOT switch the tab: (1) caret parked in the middle of a multi-line draft in
      the New Session prompt; (2) on a live session with the `❯` inbox focused mid-text; (3) on the
      relationship graph tab; (4) in nav mode (so plain keys forward raw to the pane). From each, press ⌘+↓
      (or ⌥+↓) then ⌘+↑ (or ⌥+↑) and read which tab is selected after each. Separately, from any tab press
      ⌥+N (Option+N — note ⌥N emits a dead-key `˜` glyph on a mac, so this also proves the e.code match) and
      read the selection. Finally, test the input box's stability against PLAIN arrows: with the New prompt (or
      a live `❯` box) focused, put the caret on its FIRST line and press a plain ↑, then on its LAST line and
      press a plain ↓, and read whether the selected tab moved. Screenshot the tab list before and after each press.
    expected: |
      ⌘/⌥/⌃+↑/↓ ALWAYS step the selected tab one row up/down the session list, no matter which input holds
      focus — mid-word in a textarea, on the graph tab, or while nav mode forwards raw keys — and the
      modifier never moves the textarea caret nor reaches the agent's pane instead. ⌥/⌘+↑ no longer jumps to
      New Session; it simply steps up the list (from the graph it enters the list). ⌥+N snaps the selection to
      New Session from any tab, the graph and nav mode included — ⌘+N (mac) / ⌃+N (win/linux) are the browser's
      reserved new-window chord a web page can't cancel, so they are not claimed. A plain ↑/↓ pressed inside a
      text input NEVER switches tabs — at the first line a plain ↑ and at the last line a plain ↓ both stay in
      the box (caret keys only), so typing never jerks the selection; plain ↑/↓ walk the list only when focus is
      outside any text input.
  - name: input-grows-no-premature-scrollbar
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
