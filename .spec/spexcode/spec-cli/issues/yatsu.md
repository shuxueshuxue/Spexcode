---
scenarios:
  - name: merged-read
    tags: [cli]
    code: spec-cli/src/issues.ts
    related: [spec-cli/src/proposals.ts, spec-forge/src/links.ts]
    description: >-
      In a repo with BOTH stores populated — real forge issues (some carrying `Spec:` markers) and a local
      forum thread — run `spex issues` / `spex issues --all --json` through the real CLI.
    expected: >-
      ONE list carries both stores, each issue store-tagged (`local` / the forge host) with the same shape:
      a forge issue arrives with by=forge author, created=forge timestamp, its permalink url, and its
      `Spec:` markers already translated into nodes[] (no downstream consumer ever sees a marker); the
      local thread arrives with its signers/replies/evidence. --store and --node filter; default hides
      non-open.
  - name: local-degrade
    tags: [cli]
    code: spec-cli/src/issues.ts
    description: >-
      Run `spex issues` in a repo with local threads but NO reachable forge (no gh/repo/auth).
    expected: >-
      The local list still prints in full, and exactly one loud stderr note reports the forge is
      unreachable ("listing local only") — local reading never hostages on a network, and the degrade is
      never silent.
---

# measuring issues

YATU through the real `spex issues` against a real forge (`gh`) and the real trunk forum — never a mocked
driver. The merged-read is measured in the live repo itself (its GitHub issues + a genuine local concern);
the degrade leg in a throwaway repo with no forge. The loss is the gap between the one-object claim and
the reading: same shape both stores, markers invisible downstream, loud local-only degrade.
