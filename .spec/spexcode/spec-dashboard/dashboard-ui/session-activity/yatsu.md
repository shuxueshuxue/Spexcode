---
scenarios:
  - name: headline-is-self-summary
    description: >-
      Open the dashboard with at least one live WORKING session (its tmux pane title set) and look at the
      top-left session window. Each row is two lines. Read Row 1: it is the avatar + the session's HEADLINE —
      the worker's OWN live tmux self-summary (its pane title), single-line with an ellipsis — NOT the node
      name, branch, or the few words the human typed at launch. Read Row 2: a smaller, dimmer line carrying
      the colour-coded status word and the op tally (e.g. `working  ~2`). A session that has not come up yet
      (queued / booting, no pane title) shows its launch-prompt placeholder on Row 1 instead, and Row 2 still
      shows its status. Screenshot it and file with `spex yatsu eval session-activity --image <png> --pass`.
    expected: >-
      A live working session's Row 1 is its tmux self-summary used AS the headline — the agent's own
      description of what it is doing now, having overridden the launch-prompt placeholder it started with;
      Row 2 below carries the status word + op count in a quieter font. A not-yet-live row shows the prompt
      placeholder as its headline and still shows its status on Row 2. The headline is the worker's own pane
      title (or, when present, a human rename), never a bare derived label while the agent is up.
    code:
      - spec-cli/src/sessions.ts
      - spec-dashboard/src/SessionWindow.jsx
---
# yatsu.md — session-activity

Product surface, measured by **looking** (YATU): the agent screenshots the rendered session window and
confirms each live row uses the worker's pane-title self-summary AS its Row-1 headline (the launch-prompt
placeholder showing only before the agent is up), with the status word + op tally dropped to Row 2 — filing
it as a reading with image evidence and a verdict. The scenario scopes its freshness `code:` to the capture
(`sessions.ts`) and the render (`SessionWindow.jsx`) — not the shared stylesheet — so an unrelated CSS edit
elsewhere doesn't stale this reading.
