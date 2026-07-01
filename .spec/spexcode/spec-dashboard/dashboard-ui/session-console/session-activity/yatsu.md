---
scenarios:
  - name: headline-is-self-summary
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard with at least one live WORKING session (its tmux pane title set) and look at the
      top-left session window. Each row is two lines. Read Row 1: it is the avatar + the session's HEADLINE —
      the worker's OWN live tmux self-summary (its pane title), single-line with an ellipsis — NOT the node
      name, branch, or the few words the human typed at launch. Read Row 2: a smaller, dimmer line carrying
      the colour-coded status word and the op tally (e.g. `working  ~2`). A session that has not come up yet
      (queued / booting, no pane title) shows its launch-prompt placeholder on Row 1 instead, and Row 2 still
      shows its status. Crucially, watch a session through its FIRST seconds of coming up: Row 1 must hold the
      launch-prompt placeholder steadily and then switch ONCE to the agent's glyph-led self-summary — it must
      NOT flicker through tmux's default pane title (the host name, e.g. `ser581555022561`) or a bare `Claude
      Code` splash on the way, because a genuine self-summary always leads with a status glyph and a
      glyph-less title is rejected as "not spoken yet". Screenshot it and file with `spex yatsu eval
      session-activity --image <png> --pass`.
    expected: >-
      A live working session's Row 1 is its tmux self-summary used AS the headline — the agent's own
      description of what it is doing now, having overridden the launch-prompt placeholder it started with;
      Row 2 below carries the status word + op count in a quieter font. A not-yet-live row shows the prompt
      placeholder as its headline and still shows its status on Row 2. A just-booting row keeps that
      placeholder until the agent's glyph-led summary lands — it never flashes the host name or a bare `Claude
      Code` splash in between. The headline is the worker's own pane title (or, when present, a human rename),
      never a bare derived label or tmux default while the agent is up.
    code:
      - spec-cli/src/sessions.ts
      - spec-dashboard/src/SessionWindow.jsx
  - name: console-header-matches-headline
    tags: [frontend-e2e, desktop]
    description: >-
      Through the running dashboard in a real browser, open the session interface (Enter) on a LIVE WORKING
      session whose tmux pane title (self-summary) is set, so its row headline is the agent's own live line —
      visibly NOT the bare node name. Read the **slim action strip** over the terminal's top edge (the
      `si-th-name` headline) and compare its text to that session's row headline in the
      left list / top-left window. Then pick a session whose headline is long enough to truncate in the
      narrow rows and check how much of it the wide strip shows. Screenshot the action strip next to a session
      row and file with `spex yatsu eval session-activity --image <png> --pass`.
    expected: >-
      The action strip headline shows the SAME line as the row headline — the worker's live tmux self-summary
      (its pane title), a launch-prompt placeholder only before the agent is up, a human rename always
      winning — never the stable node/branch name it used to show. The two surfaces read one shared
      content; the only difference is room: a headline that ellipsises early in the compact row shows far
      more of itself in the wide strip before truncating. A turn that retitles the row retitles the strip
      in lock-step.
    code:
      - spec-dashboard/src/SessionInterface.jsx
      - spec-dashboard/src/session.js
      - spec-dashboard/src/styles.css
  - name: codex-headline-is-task-not-folder
    tags: [frontend-e2e, desktop]
    description: >-
      Launch a CODEX session into a worktree whose folder name differs from the task (e.g. branch
      `node/codex-naming` → worktree folder `codex-naming`, task "Implement codex session naming"). Codex sets
      its tmux pane title to a spinner glyph + the cwd BASENAME (`⠙ codex-naming`), not a task summary. Open
      the dashboard and read that session's Row-1 headline (and the Enter console action strip). It must be the
      TASK — the launch-prompt preview — NOT the worktree folder name `codex-naming`. Contrast a CLAUDE
      session in the same view: its headline IS its live pane-title self-summary, unchanged. Screenshot both
      rows and file with `spex yatsu eval session-activity --image <png> --pass`.
    expected: >-
      The codex row's headline is its launch-prompt task, never the worktree folder name its pane title
      carries — because codex's pane title is NOT a self-summary (the harness declares
      `paneTitleIsSelfSummary: false`), so `activity` is suppressed and the headline falls through to the
      prompt preview. The claude row is unaffected: its headline is still its own live tmux self-summary. One
      harness capability decides which side of the fork a session lands on; neither harness shows a folder name
      as a headline.
    code:
      - spec-cli/src/sessions.ts
      - spec-cli/src/harness.ts
  - name: search-and-lock-hint-match-the-board-headline
    tags: [frontend-e2e, desktop]
    description: >-
      Through the running dashboard in a real browser, read the session names the human sees on the SESSION
      BOARD — the top-left window rows (`.sess-id`), where a live worker shows its self-summary headline, NOT
      its raw node/branch/id. Then open the search palette (⌘/Ctrl+/ over the session board, or `/` on the
      board) and read the SESSION rows' titles. Compare them to the board headlines. Also lock a session
      (single-click its window row) and read the lock-hint banner's name. Finally, type a stable-handle
      fragment (a session's node/branch/id) into the palette and confirm that session still matches.
      Screenshot the board window beside the open palette.
    expected: >-
      Every session reads as ONE name across surfaces: each board-window headline appears verbatim as that
      session's title in the search palette, and the lock-hint banner shows the same headline — the palette
      and lock banner no longer show the raw stable handle (node/branch/id) while the board shows the live
      self-summary. A human rename still wins everywhere. Search still MATCHES the stable handle even though
      it no longer displays it, so typing a session's node/branch/id still finds it (the handle rides in the
      row's match body). The place a session is searched from and the place it is found never disagree.
    code:
      - spec-dashboard/src/SpecSearch.jsx
      - spec-dashboard/src/App.jsx
---
# yatsu.md — session-activity

Product surface, measured by **looking** (YATU): the agent screenshots the rendered session window and
confirms each live row uses the worker's pane-title self-summary AS its Row-1 headline (the launch-prompt
placeholder showing only before the agent is up), with the status word + op tally dropped to Row 2 — filing
it as a reading with image evidence and a verdict. The scenario scopes its freshness `code:` to the capture
(`sessions.ts`) and the render (`SessionWindow.jsx`) — not the shared stylesheet — so an unrelated CSS edit
elsewhere doesn't stale this reading.
