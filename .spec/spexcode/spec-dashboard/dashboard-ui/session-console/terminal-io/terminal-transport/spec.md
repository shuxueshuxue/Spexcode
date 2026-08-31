---
title: terminal-transport
status: active
hue: 280
desc: The terminal host receives one injectable connection seam, keeping transport details outside the xterm component.
code:
  - spec-dashboard/src/terminal/transport.ts
related:
  - spec-dashboard/src/terminal/index.ts
  - spec-dashboard/src/terminal/SessionTerminal.tsx
  - spec-dashboard/src/SessionTerm.jsx
  - spec-dashboard/src/resilientSocket.js
---
# terminal-transport

The terminal component depends on one small host-supplied connection seam: a session connection can send
terminal bytes, resize the pane, receive output, and close. The component does not know WebSocket URLs,
dashboard session state, or the backend adapter that implements that connection. `transport.ts` keeps that
boundary typed so a host can provide a different transport without changing terminal behavior.

The dashboard supplies its resilient socket at the host boundary. The seam owns no reconnect policy and no
rendering behavior; those remain with the dashboard socket and the terminal surface respectively.
