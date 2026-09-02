---
title: desktop-packaging
status: pending
hue: 25
desc: Phase-one unsigned desktop bundles carry one self-consistent SpexCode CLI closure built from this commit.
related:
  - spec-desktop/main.js
  - spec-desktop/package.json
  - spec-desktop/electron-builder.config.cjs
  - scripts/desktop-pack.mjs
  - spec-desktop/wsl-bootstrap.sh
  - spec-desktop/wsl.js
  - package.json
---
# desktop-packaging

Phase one packages the existing Electron shell as an unsigned, self-contained desktop application. The
implementation uses **electron-builder** because it already emits the required Linux AppImage/deb targets and
keeps later dmg/nsis target declarations in one configuration without adding a second forge lifecycle.

The builder's `extraResources` contains a SpexCode runtime assembled from this monorepo at one git commit:
the root package tarball, every `@spexcode/*` workspace tarball, each package's built `dist`, and production
`node_modules` for external runtime dependencies. Internal packages are packed locally and staged together;
the pack driver refuses a missing workspace, a version drift, or a commit-stamp drift, and never resolves an
internal package from the npm registry. Each staged package manifest carries `spexcodeCommit`, and
`commit.json` records the same full HEAD for inspection. The desktop package metadata and every bundled
manifest use the root package version from that commit; the contract check and pack driver reject a version
that differs from the monorepo root.

The packaged shell sets `SPEXCODE_DESKTOP_ENTRY` to `resources/spexcode/bin/spex.mjs`. WSL bootstrap receives
the packaged tarball directory as an explicit Windows resource path translated to `/mnt/c/...`; it installs
that complete local tarball set and refuses to continue when the set is absent or empty. There is no npm
fallback, so a Windows first run cannot recreate the github#108 mixed-release failure.

Electron's **runAsNode fuse remains enabled**. `node-entry.mjs` depends on `ELECTRON_RUN_AS_NODE` when the
gateway child re-spawns the bundled CLI, and the build config asserts `electronFuses.runAsNode: true` before
electron-builder runs. Phase one does not sign, notarize, or auto-update. Linux AppImage and deb are measured
now; dmg and nsis target declarations are present for later platform lanes.

The Linux bundle declares the `spexcode` URL scheme in electron-builder metadata. A deb installation receives
that desktop entry from the package manager; a portable AppImage writes the equivalent user desktop entry under
`$XDG_DATA_HOME/applications` and registers it with `xdg-mime` at first launch. This is the supported AppImage
desktop-integration path: `xdg-mime query default x-scheme-handler/spexcode` must name `spexcode.desktop`, and
`xdg-open spexcode://...` must focus the already-running packaged shell.

`npm run desktop:pack` is an explicit developer/evidence command and is not part of normal installs or CI. The
pack driver selects native targets from the host platform (Linux AppImage/deb, macOS dmg, Windows nsis), with
`SPEXCODE_DESKTOP_PLATFORM` and `SPEXCODE_DESKTOP_TARGETS` available for a deliberate evidence override. The
macOS phase is an unsigned dmg with Electron's ad-hoc signature, installed outside the checkout. Its packaged
`.app` must declare `CFBundleURLTypes` for `spexcode`; a quarantined dmg is inspected on the measured macOS
version to record the exact Gatekeeper prompt for Tier 2 distribution, which is evidence rather than a pass/fail
product claim. The Aqua GUI run also rechecks keychain readability and records the plain `claude` launcher's
authentication result without softening a failure.
Electron remains outside the root workspaces; `npm run desktop:install` is the only installation path for its
toolchain. The pack command writes artifacts and its README under `/home/jeffry/spex-evidence/<lane>/` (or
`SPEXCODE_EVIDENCE_DIR`), never into the repository.
