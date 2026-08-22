---
scenarios:
  - name: shell-renders-dashboard
    tags: [desktop]
    description: >-
      Launch the real Electron shell against a small committed git project. Wait for the window to settle,
      inspect the rendered document through the window's browser surface, and capture the settled window image.
      The dashboard origin must be the gateway started by the shell, not the backend API index.
    expected: >-
      The window document has a non-empty project title and contains the dashboard root `.app` element; its
      body is the graph shell (rail/HUD/graph), not the backend's plain-text route index. The attached `m0b-`
      screenshot is captured after that selector is present.
    code: [spec-desktop/main.js]
    related: [spec-desktop/node-entry.mjs]
  - name: shell-death-reaps-backend-tree
    tags: [desktop]
    description: >-
      Launch the real Electron shell, record the backend and dashboard ports from their ready lines, then
      `kill -9` the Electron main process. Poll `ss -tlnp`, `ps`, and the user's systemd scopes for those
      exact ports and the shell-owned process tree.
    expected: >-
      Before the kill both ports are listening and both service scopes are active. After the kill the exact
      ports have no listener, no `spec-desktop` backend or node-entry process remains, and no
      `spex-desktop-*` scope remains. This is the fail-to-pass repair for the measured reparenting leak.
    code: [spec-desktop/node-entry.mjs, spec-desktop/main.js]
---
# eval.md - spec-desktop

The shell is measured through the real Electron window and its real process boundary. Linux evidence uses the
user systemd cgroup adapter; Windows Job Objects and a macOS equivalent remain explicitly unavailable in the
current implementation and are not claimed by these scenarios.
