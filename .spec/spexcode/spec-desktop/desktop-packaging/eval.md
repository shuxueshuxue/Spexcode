---
scenarios:
  - name: packaged-shell-renders-hub
    tags: [desktop]
    description: >-
      Build the AppImage from the current commit, launch it outside the checkout with an isolated
      SPEXCODE_HOME, and wait for the gateway and projects hub.
    expected: >-
      The packaged CLI starts `spex dashboard`, the shell loads the projects hub, and a screenshot shows the
      settled hub from the real AppImage process.
    related: [spec-desktop/main.js]
  - name: packaged-cli-is-self-consistent
    tags: [desktop]
    description: >-
      Inspect the CLI closure inside the AppImage resources and invoke its bundled `spex --version`.
    expected: >-
      Every @spexcode package manifest has one version and the same full `spexcodeCommit`; `commit.json`
      names the measured HEAD and `spex --version` reports that HEAD's package version.
    related: [scripts/desktop-pack.mjs]
  - name: packaged-deep-link-linux
    tags: [desktop]
    description: >-
      Register the packaged AppImage desktop entry, verify xdg-mime maps spexcode:// to it, then run
      `xdg-open spexcode://...` while the packaged app is already running.
    expected: >-
      The desktop registration claims the spexcode:// scheme and xdg-open focuses the existing packaged
      window rather than starting a second shell.
    related: [spec-desktop/desktop-integration.js]
  - name: quit-leaves-backends-running
    tags: [desktop]
    description: >-
      Launch the packaged app against a disposable project, then quit the shell and inspect the host records.
    expected: >-
      Quitting closes the Electron gateway utility child but leaves project backends running and discoverable;
      no backend is killed as a side effect of the packaged window closing.
    related: [spec-desktop/main.js]
---
# eval.md - desktop-packaging

These scenarios are measured on the ThinkPad through the real AppImage with `DISPLAY=:0` and
`XAUTHORITY=/run/user/1000/gdm/Xauthority`. Evidence is stored under `/home/jeffry/spex-evidence/<lane>/`,
published with `spex session files add`, and filed with `spex eval add` against the commit that was measured.
