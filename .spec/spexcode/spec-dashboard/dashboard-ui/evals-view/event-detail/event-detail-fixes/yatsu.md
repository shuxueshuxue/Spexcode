---
scenarios:
  - name: draft-leak-selection-reset
    tags: [frontend-e2e]
    code: [spec-dashboard/src/EventDetail.jsx, spec-dashboard/src/Thread.jsx]
    description: >
      In a real browser on #/evals, select one eval, create or type an anchored/circled remark draft in
      the rail composer, then switch to a different eval row and read the new composer's textarea before
      sending anything. Switch back and repeat with a plain typed draft.
    expected: >
      Switching the selected eval clears the rail composer immediately. No anchored line, circled-frame
      markdown, evidence link, or plain typed body from the prior (node, scenario) appears in the new
      eval's composer, so sending from the new selection cannot post the old eval's remark to the wrong
      thread.
  - name: eval-originator-chip-session-route
    tags: [frontend-e2e]
    code: [spec-dashboard/src/Dashboard.jsx, spec-dashboard/src/EventDetail.jsx, spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/Thread.jsx]
    description: >
      In a real browser on #/evals, select an eval whose latest reading was filed by a live session.
      Click its filer/originator liveness chip in the event-detail header and read location.hash plus the
      selected session console tab.
    expected: >
      The live eval filer chip navigates to `#/sessions/<session-id>` and selects that session's console.
      It never opens `#/sessions/new`; offline or missing filers remain non-clickable labels.
  - name: eval-comment-outcome-flash
    tags: [frontend-e2e]
    code: [spec-dashboard/src/EvalsPage.jsx]
    description: >
      In a real browser on #/evals, send an eval remark whose body contains `@new`, wait for the write
      response, and read the page notice above the eval list.
    expected: >
      The Evals page briefly echoes the returned mention outcome, such as `@ new→<session>`, after the
      remark write succeeds, matching the Issues page's reply flash behavior.
---
# event-detail-fixes loss

Measure through the real dashboard and backend. The proof is the browser's visible composer state, hash
route, selected session tab, and page notice after the same write path a human uses.
