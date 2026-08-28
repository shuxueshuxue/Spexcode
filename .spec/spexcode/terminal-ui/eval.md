---
scenarios:
  - name: terminal-ui-package-and-dashboard-binding
    tags: [frontend-e2e]
    test: packages/terminal-ui/src/render.test.tsx
    code: packages/terminal-ui/src/index.ts
    description: Build and server-render the terminal package, then run the dashboard warm-switch terminal scenario on the rebuilt dist.
    expected: The package test passes through react-dom/server, the xterm patch is applied or the build fails loudly, and the dashboard keeps mounted terminals across a session switch while hidden output is withheld.
---
# terminal-ui-package-and-dashboard-binding

From a clean checkout, build and test `@spexcode/terminal-ui`, then build the dashboard and run the terminal
warm-switch end-to-end scenario. The package suite must pass its server-rendered host test, the package build
must apply the xterm 6.0.0 patch or fail loudly, and the dashboard must keep two mounted terminals across a
session switch while hidden output is withheld and the visible session repaints.
