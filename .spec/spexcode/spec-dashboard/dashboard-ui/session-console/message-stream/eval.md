---
scenarios:
  - name: full-read-and-append-follow
    tags: [backend-api]
    description: >-
      Through a real running backend, create a governed fixture session in the global store with a
      messages.ndjson containing native user and assistant events. GET /api/sessions/:id/messages, then open
      /api/sessions/:id/messages/stream at the returned cursor and append one complete event line. Also probe a
      known fixture whose messages file does not yet exist.
    expected: >-
      The REST response returns every complete event in file order and a byte cursor. The SSE emits only the
      newly appended event with its next cursor as the event id, without a board refetch. A known missing file
      returns an empty list and cursor zero; an unknown session is 404. No partial or malformed event is silently
      presented as valid data.
    test: spec-cli/src/message-stream.test.ts
    code: spec-cli/src/message-stream.ts
    related:
      - spec-cli/src/index.ts
  - name: headless-console-renders-native-events
    tags: [frontend-e2e, desktop]
    description: >-
      In a real desktop browser, open the Sessions page on a fixture session whose graph row identifies the
      claude-headless harness and whose global messages.ndjson contains a user turn, assistant text, and a tool
      use. Let the page settle, then inspect the visible console, toolbar, and DOM; append another assistant event
      before the run ends and confirm it appears without reloading the page.
    expected: >-
      The right pane is a Messages console with ordered user and assistant bubbles plus a compact tool-call row;
      it contains no xterm canvas, terminal placeholder, or tmux socket. The toolbar remains the ordinary compact
      session toolbar with Eval and available commands. The appended assistant event appears from SSE, and the
      settled layout has no overlap or clipped message text at desktop width. Pane-backed session consoles are
      unchanged.
    code: spec-dashboard/src/SessionMessages.jsx
    test: spec-dashboard/test/message-stream.e2e.mjs
    related:
      - spec-dashboard/src/messageStream.js
      - spec-dashboard/src/data.js
      - spec-dashboard/src/SessionInterface.jsx
      - spec-dashboard/src/styles.css
---

Measure the API through a running SpexCode backend and the visual state through the real Sessions route in a
browser. The browser fixture may supply `claude-headless` in the graph until that parallel adapter branch lands;
the message bytes still come from the real global session artifact and the real REST/SSE routes.
