---
scenarios:
  - name: link-focuses-running-window
    tags: [desktop]
    description: >-
      With the shell running on a project, invoke `xdg-open spexcode://p/<id>/<node address>` (or the platform
      opener) from a terminal.
    expected: >-
      No second process survives, the existing window gains focus, and its location is the addressed node.
    related: [spec-desktop/main.js]
  - name: spex-open-prints-and-opens
    tags: [cli]
    description: >-
      Run `spex open <node-id>` in a project with a running gateway.
    expected: >-
      Stdout is the `http://` address of that node under `/p/<projectId>/`; the platform opener is invoked with
      it exactly once.
    related: [spec-cli/src/cli.ts]
---
# eval.md - desktop-deep-link
