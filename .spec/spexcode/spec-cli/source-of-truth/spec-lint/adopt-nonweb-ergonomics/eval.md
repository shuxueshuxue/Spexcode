---
scenarios:
  - name: nonweb-zero-match-guides
    description: >
      In a non-web (Python) git repo whose spexcode.json sets governedRoots but leaves the web-default
      sourceExtensions (ts/tsx/js/jsx), run `spex spec lint`. Coverage finds zero source. Read the transcript.
    expected: >
      The `coverage` warning is a self-explanatory repair entrypoint, not a dead end: it echoes the
      CURRENT sourceExtensions and governedRoots values (so the ts-in-a-py-tree mismatch is visible),
      names BOTH knobs, states they nest under the `lint` key (a top-level key no-ops), and gives
      copy-pasteable non-web extension examples. Nothing about it points only at governedRoots.
    tags: [cli]
    code: spec-cli/src/lint.ts
  - name: forgiving-input-normalized
    description: >
      In the same Python repo, set sourceExtensions to a DOTTED form `[".py"]` and testGlobs to a
      slash-less `["*.test.py"]`, with .py sources at src/main.py and src/pkg/util.py and a nested test
      src/pkg/util.test.py. Run `spex spec lint` and read the coverage findings.
    expected: >
      Both forgiving inputs are normalized instead of silently matching zero: the dotted extension is
      accepted so src/main.py and src/pkg/util.py are enumerated (reported uncovered until governed),
      and the slash-less test glob is widened to any depth so src/pkg/util.test.py is EXCLUDED from
      coverage. No "governing NOTHING" warning appears.
    tags: [cli]
    code: spec-cli/src/lint.ts
---

# adopt-nonweb-ergonomics — how its loss is measured

YATU through the real `spex spec lint` CLI, never by reading lint.ts. Stand up a throwaway git repo shaped
like a non-web adopter (a `.spec/project` node, `.py` sources, a `spexcode.json`), run `spex spec lint` with
`node spec-cli/bin/spex.mjs spec lint` from that repo's root, and read the emitted coverage transcript. The
measurement is the actual CLI output an adopter would see — the message text and which files coverage
does and does not flag — compared against the expected repair-entrypoint wording and normalization.
