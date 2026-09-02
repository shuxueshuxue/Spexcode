---
scenarios:
  - name: first-run-without-wsl
    tags: [desktop]
    description: >-
      On a Windows host with WSL absent (or a v1-only distro), launch the shell.
    expected: >-
      The first-run page renders naming `wsl --install` and reboot as the user's action; no gateway process and
      no native fallback is started; the app stays on that page.
    related: [spec-desktop/main.js]
  - name: bootstrap-transcript-then-dashboard
    tags: [desktop]
    description: >-
      On a Windows host with a fresh WSL2 Ubuntu, launch the shell and complete the bootstrap, typing the sudo
      password when asked.
    expected: >-
      The page shows the real apt/nvm/npm/doctor output as it happens; after `/health` answers the window shows
      the projects hub served from inside WSL; re-launching skips the page.
    related: [spec-desktop/main.js]
  - name: mnt-c-project-refused
    tags: [desktop]
    description: >-
      Use the native folder picker to select a repo under C:\ and then one under \\wsl$\<distro>\home.
    expected: >-
      The first is refused with the 9p reason and no catalog write; the second is registered with a `/home/…`
      root and appears in the switcher.
    related: [spec-desktop/main.js]
---
# eval.md - desktop-windows-wsl

Measured on a real Windows machine through the real shell; no scenario is filed from a Linux host.

Under SSH-only access the installed picker callback cannot be driven, so the refusal half of
`mnt-c-project-refused` was measured through the packaged gateway HTTP API and the `\\wsl$` registration half
is unmeasured. The missing actionable 9p explanation is tracked in github#111 for a follow-up re-measurement.
