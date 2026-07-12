---
scenarios:
  - name: three-sources-invert
    tags: [cli]
    code: spec-forge/src/links.ts
    description: >-
      Against the REAL forge: open a scratch issue whose body carries a `Spec: <real-node>` marker, one
      whose marker names a bogus id (`Spec: no-such-node-xyz`), and one with no marker; then read
      `spex issue links --json` and the merged `spex issue ls --json`. If an open PR off a `node/<id>`
      branch exists, confirm its branch link resolves by longest-match against the known ids. Close the
      scratch issues afterwards.
    expected: >-
      The marker issue appears under exactly its named node in the links read (and its nodes[] in the
      merged read); the typo'd marker links NOTHING — no invented node, the issue simply resolves to no
      node; the unmarked issue links nothing. A `node/<id>` PR resolves to the longest known id that
      prefixes its branch rest — never a guess at where the `-<sha>` suffix begins. A node's issue list is
      deduped with marker outranking the inferred PR link. Only nodes that actually have links are returned.
---

# measuring links

YATU through the surfaces that expose the resolver — `spex issue links --json` and the merged issue
read — against real forge objects created for the probe (and closed after), never by calling
`resolveLinks` on fabricated fixtures alone. The reading is the transcript showing each link source
(marker, branch, transitive) landing on the right node and the typo'd marker landing nowhere.
