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
  - name: full-process-door-follows-adapter-capability
    tags: [frontend-e2e, desktop, mobile]
    description: >-
      In real browsers at desktop and phone widths, open a `claude-headless` session whose graph row advertises
      `messageStream:true` and whose global messages.ndjson contains a user turn, assistant text, and a tool use.
      Confirm the main console is TimelineChat, then open its full-process door and append another assistant event
      before the run ends. Repeat with a pane-backed or other headless adapter whose capability is false.
    expected: >-
      On both viewport classes the headless main console is the shared TimelineChat, with no xterm canvas,
      terminal placeholder, or tmux socket. Only the adapter capability enables the full-process door; it appears
      for `claude-headless` and is absent for the false-capability fixtures, with no harness-id branch in the DOM.
      Opening the door renders ordered native user/assistant bubbles plus a compact tool-call row, and the
      appended assistant event appears from SSE without a reload. Pane-backed session consoles remain unchanged.
    code: spec-dashboard/src/SessionMessages.jsx
    test: spec-dashboard/test/message-stream.e2e.mjs
    related:
      - spec-dashboard/src/messageStream.js
      - spec-dashboard/src/data.js
      - spec-dashboard/src/SessionInterface.jsx
      - spec-dashboard/src/styles.css
---

Measure the API through a running SpexCode backend and the visual state through the real Sessions route in a
browser. Use a real `claude-headless` launcher for the positive capability reading and a real adapter without
`messageStream` for the negative reading; native bytes still come from the global session artifact and the real
REST/SSE routes.
