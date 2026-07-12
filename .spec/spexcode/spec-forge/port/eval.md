---
scenarios:
  - name: driver-loud-failure-and-comment-read
    tags: [cli]
    code: spec-forge/src/port.ts
    related: [spec-forge/src/drivers/github.ts, spec-cli/src/issues.ts]
    description: >-
      Two legs against the real driver. (a) Read leg: `spex issue show github#N` on a real issue that has
      comments, and on a CLOSED issue. (b) Failure leg: break `gh` for the process (an empty PATH shim or
      a bogus GH_TOKEN with isolated gh config) and run the forge-touching reads/writes (`spex issue links`,
      `spex issue open --store github`, `spex issue reply github#N`).
    expected: >-
      (a) The issue's comments arrive as the unified thread's replies[] (author, createdAt, body) riding
      the same list/show read — no second fetch path visible to the caller; a closed issue is still
      readable/linkable (listIssues reads ALL states). (b) Every failure is LOUD with gh's own message —
      a broken gh never looks like an empty forge; a failed forge write fails the verb with nothing queued
      and the local store untouched. Only the narrow "unknown JSON field" gh-version case may degrade, and
      it degrades ONLY transitive linking (closesIssues empty) with a single warning.
---

# measuring port

YATU through the product verbs that ride the driver (`spex issue show/links/open/reply` with
`--store github`), never by importing the driver and mocking `gh`. The failure leg sabotages the real
`gh` in the probe's environment only; the transcript capturing gh's own error surfacing through the verb
IS the reading — the loss is any silent-empty-forge or blanket degrade.
