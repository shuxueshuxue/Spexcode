---
scenarios:
  - name: browser-entry-has-no-node-import
    tags: [cli]
    code: packages/transcript/src/index.ts
    related: packages/transcript/package.json
    description: Build the package and inspect the module graph reachable from the `./frames` export and from the root export.
    expected: `dist/frames.js` and `dist/turns.js` import no `node:` module; the root entry re-exports readers, parsers, frames, and the live source; `engines.node` is `>=18` and the build lib is ES2022.
---

The package is measured by its own suite (`npm test --workspace=@spexcode/transcript`) and by its adopters' scenarios;
this node's scenario guards only the boundary the two entries promise.
