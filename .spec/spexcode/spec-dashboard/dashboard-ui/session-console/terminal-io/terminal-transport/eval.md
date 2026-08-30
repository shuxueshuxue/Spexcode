---
scenarios:
  - name: host-supplied-terminal-transport
    tags: [frontend-e2e]
    test: spec-dashboard/src/terminal/render.test.tsx
    code: spec-dashboard/src/terminal/transport.ts
    related: [spec-dashboard/src/terminal/index.ts, spec-dashboard/src/terminal/SessionTerminal.tsx, spec-dashboard/src/SessionTerm.jsx]
    description: Server-render the dashboard terminal with a host-supplied transport implementation.
    expected: The terminal host renders without knowing dashboard WebSocket details, and the typed connection seam remains the only transport contract passed into the xterm component.
---
