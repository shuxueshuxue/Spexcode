---
scenarios:
  - name: owned-dashboard-package-or-actionable-absence
    tags: [cli]
    description: >
      In a clean root-tarball install without @spexcode/spec-dashboard, run `spex serve ui` and capture its
      stderr and exit. Then explicitly install the dashboard tarball and use the installed CLI to run `spex
      serve ui`, `spex dashboard`, and `spex flat site`; fetch the UI's index and hashed script and compare the
      flat shell with the installed package's dist-public shell.
    expected: >
      Without the package, serve ui exits 1 before binding and says `dashboard UI is not installed
      (@spexcode/spec-dashboard). Install it with: npm install @spexcode/spec-dashboard`, with no stack trace.
      After the explicit install, all three commands complete their normal product paths and the served/copied
      assets come from the installed dashboard package.
---
# release-artifacts loss

The absence path is a CLI transcript and the present paths are driven through the installed product, rather than
through an internal asset resolver.
