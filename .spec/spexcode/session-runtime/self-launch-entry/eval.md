---
scenarios:
  - name: installed-package-has-the-narrow-public-entry
    tags: [backend-api]
    description: >
      Pack the adopter, install its tarball with the protocol tarball into a clean external consumer, import it only
      by package name, and inspect package resolution, runtime exports, declarations, bin target, and packed files.
    expected: >
      Resolution points under the consumer's node_modules; only the frozen locality and path resolver symbols are
      public; the binary imports compiled dist code; and no repository source, daemon, core/topology product package,
      or release-script integration is present.
    code: packages/session-selflaunch/src/index.ts
---
# self-launch package entry loss

Only an external tarball consumer measures the published boundary. Source imports and workspace links are excluded
because they can bypass `files`, `exports`, dependency resolution, and the installed bin shim.
