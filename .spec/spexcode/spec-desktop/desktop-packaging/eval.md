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
  - name: packaged-deep-link-mac
    tags: [desktop]
    description: >-
      With the installed packaged macOS app running, invoke `open spexcode://p/<id>/<address>` from the Aqua
      session and inspect the existing window.
    expected: >-
      The app's `CFBundleURLTypes` registration routes the link to the running instance, which focuses the
      existing window and navigates its gateway page without spawning a second shell.
    related: [spec-desktop/desktop-integration.js, spec-desktop/deep-link.js]
  - name: packaged-mac-gui-reads-keychain
    tags: [desktop]
    description: >-
      From the packaged app's Aqua-launched gateway, add the fixture project and dispatch a real session with
      the plain `claude` launcher; inspect the session's recorded state and the Aqua-domain credential path.
    expected: >-
      The worker authenticates and reaches a live session because the packaged app's backend runs inside the
      Aqua session and can read the login keychain. A failure to authenticate or reach a live session is a
      finding against this claim and must be filed honestly.
    related: [spec-desktop/main.js, spec-cli/src/sessions.ts]
  - name: gatekeeper-quarantine
    tags: [desktop]
    description: >-
      Apply a quarantine xattr to the dmg and installed app, then run macOS assessment and LaunchServices
      opening on the measured OS version.
    expected: >-
      The quarantined ad-hoc app still launches (`open` exits 0 and the window appears), while
      `spctl --assess` refuses it with the recorded text; preserve the codesign and xattr dump as Tier 2
      distribution evidence.
    related: [spec-desktop/electron-builder.config.cjs]
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
- `packaged-deep-link-mac`: `open spexcode://p/<id>/<address>` focuses and navigates the running window via `CFBundleURLTypes`.
- `quit-leaves-backends-running`: normal quit leaves a detached backend healthy and discoverable.
- `packaged-mac-gui-reads-keychain`: a real session dispatched from the packaged app's gateway must authenticate
  through the plain `claude` launcher using the Aqua-domain keychain; failures are findings against the claim.
- `gatekeeper-quarantine`: after applying quarantine xattrs to the dmg, record exactly what this macOS version
  shows for the ad-hoc-signed app; this is Tier 2 distribution evidence, not a product failure.
