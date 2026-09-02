---
scenarios:
  - name: window-paging-reassembles-the-file
    tags: [backend-api]
    description: >-
      Against a running `spex serve`, request `/api/source` for a governed file with a `limit` that is
      deliberately not a line multiple, then keep requesting with `offset` advanced by the previous
      response's `bytes` until `eof`. Record every response's `{size, offset, bytes, eof}` and the
      concatenated text. File the transcript with `spex eval add source-read --scenario
      window-paging-reassembles-the-file --result <txt> --pass`.
    expected: >-
      Every response reports the file's TOTAL size, not the window's. The concatenation of all windows equals
      the file byte-for-byte, and exactly one response carries `eof: true`. A `limit` above the slice ceiling
      is clamped and served, never refused.
      A non-final window ends on a newline, so a caller resumes at a line start — with ONE deliberate
      exception: a window that contains no newline at all, because a single line is longer than it, is handed
      over raw. Snapping there would return zero bytes and the reader would hang forever on a minified file,
      so the exception is the behaviour and not a gap in it. The measurement must therefore distinguish "did
      not end on a newline" from "contained no newline"; only the first is a defect.
  - name: policy-refusals-are-loud
    tags: [backend-api]
    description: >-
      Against the same running backend, request `/api/source` for each of: a path escaping the worktree
      (`../etc/passwd`), an absolute path, a spec-tree file (`.spec/…/spec.md`), `.spec/spexcode.json`, a test
      file, and a path that does not exist. Record each status and body.
    expected: >-
      Every one is refused with a status and a sentence naming why — an escape as 400, everything the source
      policy declines as 404. No refusal returns an empty body or a 200, because a viewer cannot tell "you
      may not read this" apart from "this file is blank". The refused set follows from the SAME predicate the
      coverage walk uses, so it needs no separate list to keep in sync.
---
# eval.md - source-read

Both scenarios are measured through the HTTP route rather than the reader function, because the contract
being sold is the route's: a caller who only ever sees `/api/source` must be able to page a file and to tell
a refusal from an empty file. The unit tests cover the same ground at the function boundary and are the
faster signal; these are the ones that would still catch a route that forgot to map `SourceReadError` onto
its status.
