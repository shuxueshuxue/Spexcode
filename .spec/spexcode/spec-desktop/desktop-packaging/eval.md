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

Linux scenarios are measured on the ThinkPad through the real AppImage with `DISPLAY=:0` and
`XAUTHORITY=/run/user/1000/gdm/Xauthority`. macOS scenarios are measured on `macmini-tail` from the logged-in
Aqua session using a throwaway `gui/<uid>` LaunchAgent; the dmg is mounted and the `.app` is copied to a
temporary install directory outside the checkout. Evidence is stored under `/home/jeffry/spex-evidence/<lane>/`,
published with `spex session files add`, and filed with `spex eval add` against the commit that was measured.

The macOS phase adds these scenarios:

- `packaged-shell-renders-hub`: the installed packaged `.app` renders the projects hub.
- `packaged-cli-is-self-consistent`: bundled `@spexcode/*` versions and commit stamp match the monorepo.
- `desktop-deep-link`: `open spexcode://p/<id>/<address>` focuses the running window via `CFBundleURLTypes`.
- `quit-leaves-backends-running`: normal quit leaves a detached backend healthy and discoverable.
- `mac-gui-launch-reads-keychain`: the Aqua-domain keychain read is recorded alongside the plain `claude`
  launcher's actual authentication result.
- `gatekeeper-quarantine`: after applying quarantine xattrs to the dmg, record exactly what this macOS version
  shows for the ad-hoc-signed app; this is Tier 2 distribution evidence, not a product failure.
