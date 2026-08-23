# Desktop Boundary Audit

Date: 2026-08-23  
Authoritative checkout: `main@c2b851648`

This audit records what the inherited desktop requests prove today and where the
product contract stops. It is deliberately a boundary record, not a proposal to
ship an installer without an approved distribution target.

## Current contract

The desktop surface is an optional Electron window over the existing product:

- `npm run desktop:install` installs the private `spec-desktop` package.
- `npm run desktop:start` starts Electron from that package.
- `npm run desktop:check` verifies the root entrypoints, the optional-workspace
  boundary, and the same-origin `spex serve ui` contract.
- `spec-desktop/main.js` starts the existing backend plus gateway and loads the
  gateway origin. It does not define a second route, state store, or dashboard
  feature.
- `spec-desktop` is intentionally outside root `workspaces`; normal browser/CLI
  installs do not download Electron.

## Evidence on the authoritative head

Command:

```text
npm run desktop:check
```

Result: `3` tests passed, `0` failed.

The check proves the three contracts above. It does not prove an Electron launch
on this checkout: `spec-desktop/node_modules/.bin/electron` is absent because the
optional package has not been installed. No shell process or listener was started
by this audit.

The release producer also intentionally excludes `spec-desktop`: its release set
contains only the seven public CLI/dashboard/session packages listed in
`scripts/release-publish.mjs`. The root `files` list contains `bin` only, so an
ordinary package release cannot silently become a desktop distribution.

## Explicit non-claims

There is currently no approved contract for any of the following:

- an installer or artifact format (AppImage, deb, dmg, msi, etc.);
- a supported operating-system/version matrix;
- code signing, notarization, update or rollback channels;
- release registry/publish inclusion for Electron;
- CLI commands that discover, install, or launch a packaged desktop build;
- Windows Job Object or macOS process-tree containment.

The desktop spec records Linux systemd-scope containment and names the other
platform limitations. The two desktop eval scenarios are the appropriate
re-entry proof once an Electron dependency is installed: rendered dashboard
through the real window, then exact-port/process-tree reaping after shell death.

## Re-entry contract

Productization may start only after a decision names a distribution target and
support matrix. That decision must add a package builder, artifact ownership,
signing/update policy, cross-platform process containment, and real Electron
YATU/eval gates. Until then, the optional developer shell and its `3/3` contract
are the complete supported desktop scope.
