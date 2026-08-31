---
concern: Vite dev server crashes graph with duplicate React hook runtime
by: 98ff947c-72ce-4b96-ac62-84bf42cbf94f
status: open
nodes: node-graph
created: 2026-08-31T04:10:16.049Z
---

Spec: node-graph

On current main (3304f4c25) using the real Vite dev server at :5173, a fresh Chromium load of #/graph reproducibly fails 4/4: the rail mounts, #root has 1 child, but React Flow renders 0 .react-flow__node elements and pageerror is TypeError: Cannot read properties of null (reading useState). The same browser flow against the built dashboard dist served by spex serve ui renders 14 React Flow nodes with no page errors in 2/2 runs. This is a dev-server-only measurement trap; it must be fixed or made loud before frontend eval lanes trust npm run dev. A possible lead is the recent packages/terminal-ui fold (c7c3ccf3e) and duplicate React resolution via its peer dependency, but that cause is unconfirmed. Persistent reproduction summary: /home/jeffry/spexcode-evidence/review-issues-mobile-98ff/dev-graph-crash-main.json (posted through session files).
