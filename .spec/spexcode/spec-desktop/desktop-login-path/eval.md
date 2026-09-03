---
scenarios:
  - name: gui-launch-resolves-user-tools
    tags: [desktop]
    description: >-
      On a Mac whose terminal resolves tmux and the installed agent CLIs, launch the packaged app the way a
      person does — from the graphical session (Finder / `open`), not from a terminal — and read the host card
      in the running window.
    expected: >-
      tmux and each installed agent CLI report their real paths and their launchers do not read `broken`; a tool
      that is genuinely absent still reads missing. The pre-fix build on the same machine reports `tmux missing`
      with every launcher broken and `codex: missing · logged in`, which is the failing half of the pair.
    related: [spec-desktop/main.js, spec-cli/src/host-facts.ts]
---
