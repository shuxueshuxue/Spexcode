---
scenarios:
  - name: shell-renders-dashboard
    tags: [desktop]
    description: >-
      Launch the real Electron shell with no host gateway running. It must start `spex dashboard` as its
      utility child, wait for the ready line, load that origin, and render the projects hub.
    expected: >-
      The window document contains the dashboard root `.app` element and the project switcher; the loaded origin
      is the gateway the shell started, never a backend's plain-text API index. Screenshot captured after the
      selector is present.
    code: [spec-desktop/main.js]
  - name: shell-attaches-to-running-gateway
    tags: [desktop]
    description: >-
      Start `spex dashboard` by hand on a loopback port, then launch the shell. It must load the existing gateway
      and start no second one.
    expected: >-
      Exactly one `spex dashboard` process exists after the window renders, its pid unchanged from before the
      launch, and the window's location is that gateway's origin.
    code: [spec-desktop/main.js]
  - name: quit-leaves-backends-running
    tags: [desktop]
    description: >-
      From the shell, open an offline project so the gateway starts its detached `spex serve`; record that
      serve's pid and port; quit the app normally, then `kill -9` a second launch. Poll the port and pid.
    expected: >-
      After both exits the gateway process the shell owned is gone and the project's `spex serve` is still
      listening on the recorded port with the same pid; its endpoint record still validates online.
    code: [spec-desktop/main.js]
    related: [spec-cli/src/host.ts]
  - name: second-launch-focuses-first
    tags: [desktop]
    description: >-
      With the shell running, launch it again from a terminal.
    expected: >-
      The second process exits immediately, no second window appears, and the first window receives focus.
    code: [spec-desktop/main.js]
  - name: menu-add-project-registers-folder
    tags: [desktop]
    description: >-
      Launch the real Electron shell with SPEXCODE_DESKTOP_TEST_PICK_DIRECTORY naming a fixture Git repository,
      then choose File -> Add Project... from the application menu.
    expected: >-
      Electron bypasses only the native dialog under that documented test seam; the main process sends the real
      POST /projects request, the durable catalog gains the fixture root, and the project appears in the switcher.
    code: [spec-desktop/desktop-integration.js]
    related: [spec-cli/src/host.ts, spec-dashboard/src/ProjectsPage.jsx]
---
# eval.md - spec-desktop

The shell is measured through the real Electron window and the real process table. The gateway is the only
process the shell owns; backends are the web deployment's and are proven to survive the shell's death.
