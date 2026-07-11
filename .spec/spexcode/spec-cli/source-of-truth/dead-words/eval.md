---
scenarios:
  - name: gate-bites-and-tree-is-clean
    tags: [cli]
    description: >-
      Prove the dead-words gate bites on every scanned surface and passes the real tree. Run
      `node scripts/dead-words.mjs` on this repo (expect clean, exit 0). Then plant a dead word in
      a source string literal, and separately a dead-word node dir under .spec, and re-run (expect a
      hit and exit 1 each time, naming the file:line / dir). The built-in self-check (a planted
      string hit, a comment miss, a regex-literal miss) must hold on every run — a broken tokenizer
      exits 2 rather than reporting clean.
    expected: >-
      Clean tree → `dead-words: clean`, exit 0. Planted string literal → one finding
      `dead word '<w>' in string`, exit 1. Planted node dir → one finding `dead word '<w>' in node
      dir name`, exit 1. Comments, *.md, *.test.*, __fixtures__, and `dead-words-ok:`-annotated
      lines never produce findings.
---
# eval.md — dead-words

Measured through the real gate script exactly as CI invokes it (`node scripts/dead-words.mjs`, exit
code observed), on this repo's own tree — plant, observe the refusal, remove, observe clean.
