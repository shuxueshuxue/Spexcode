---
scenarios:
  - name: slash-menu-opens
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/Thread.jsx, spec-dashboard/src/reviewCommands.js, spec-dashboard/src/mentions.jsx]
    description: >
      In a real browser at a live backend: open #/evals, select a reading whose scenario is NOT yet
      human-ok'd (the /ok gate is open: the viewed reading is the scenario's latest). Read the persistent
      action row, put the caret at the start of a non-empty draft, click its '/' button, and observe the
      textarea value, focus, caret, and dropdown. Close
      it, then focus the composer and type '/'; compare the two dropdowns: which commands list, their tags,
      where they open relative to the composer container, and the row markup vs the session ❯ box's / menu.
      Type 'o' and read the filtered list; Esc closes. Then view a reading OUTSIDE the gate (an ok'd latest,
      or an older A/B pole) and type '/ok' — read what the menu offers. Finally type '/' mid-prose (not at
      line start) and read whether a menu opens.
    expected: >
      The persistent action row shows a compact '/' button beside '@' and '[[' whenever this home supplies
      review commands. From a command-eligible line start, clicking it inserts '/' at the caret, preserves
      the draft, refocuses the textarea, and opens exactly the same small command dropdown ABOVE the
      composer as typing '/' — one trigger path, not a second menu. It uses the session input's interaction grammar
      (same row shape: /name · description · tag; ↑↓ · ⏎ pick · Esc closes). It lists /ok tagged [ui] — offered ONLY under the registry's
      when-gate: the viewed reading is the scenario's latest effective one and not yet ok'd — and /refuse
      tagged [review] (from the .plugins/review surface). Outside the gate the menu offers no /ok — one
      gate in one registry, never a second judgment (and no header ok button exists anywhere). A '/'
      that is not at its line's start opens nothing. Zero loss = the command remains the ONE sign-off
      door, visible from the action row and gated in exactly one place.
  - name: ok-via-command
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/reviewCommands.js, spec-dashboard/src/EventDetail.jsx]
    description: >
      In a real browser at a live backend: on #/evals select a fresh, un-ok'd latest reading. Type '/ok'
      in the remark composer and accept it with ⏎. Read the header band, then return to the evals feed
      and read whether the scenario's row is still listed (default view) and whether the show-all chip
      reveals it. Cross-check the sidecar: the node's evals.ndjson gained a human-ok event bound to that
      reading's ts.
    expected: >
      Accepting /ok fires THE human-ok runner (the registry's one closure, the sessionCommands
      one-runner pattern): the header shows the settled ☑ human-ok mark (the typed command is the only
      write door — no header button ever renders), the sidecar carries one kind:human-ok event anchored
      to the viewed reading, and the evals feed default-hides the now fresh-AND-ok'd scenario
      (reappearing under show-all). Zero loss = /ok is the sign-off's one dashboard surface — same write,
      same gate, same feed semantics, no dashboard-only path.
  - name: refuse-prefill-ages
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/Thread.jsx, spec-dashboard/src/reviewCommands.js]
    description: >
      In a real browser at a live backend: select a reading, type '/refuse' in the composer and accept.
      Read the composer body: the template with {node} {scenario} {expected} already filled from the
      viewed reading. Edit the placeholder prose and Send. Read the remark rail and the scenario's
      staleness: the sent remark lists as an OPEN remark on the (node, scenario) thread, and the
      scenario's freshness now names the remark axis. Repeat with a ⏱-stamped anchor already in the
      composer before typing /refuse, and read whether the ▶ anchor line (and its riding frame) survives
      the prefill.
    expected: >
      Picking /refuse PREFILLS the composer with the refuse preset's body, placeholders filled at insert
      time with the viewed reading's node, scenario, and expected — and a stamped ▶ anchor head is kept
      above the template. Sending posts an ORDINARY remark on the eval's thread (the same /api/remarks
      write, identity server-derived): it renders open in the rail, and its aging pressure stales the
      scenario on the remark axis — the refuse semantic IS remark-teeth, no new write mechanism or
      verdict state. Zero loss = a human dispute reaches the loss signal as a first-class open concern,
      typed in two keystrokes.
---
# measuring review-commands

YATU through the REAL running product, never the code: worktree backend + dashboard, a headless Chromium
clicking the '/' action-row button and typing '/' into the live composer (`.fv-textarea` in the event-detail rail),
then reading the real dropdown,
the real header band, the real feed. The loss is the gap between that reading and the spec: one closure
per built-in verb gated in one registry (the slash command the sole dashboard door), the preset prose
arriving through the `surface: review` plugin gather, and every send remaining an ordinary remark. Menu
interactions are DYNAMIC — record video of the type→menu→accept flows; end states (prefilled composer,
ok'd header, hidden feed row) may add stills.
