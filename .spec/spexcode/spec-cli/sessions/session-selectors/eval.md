---
scenarios:
  - name: one-grammar-every-control-verb
    tags: [cli, backend-api]
    description: >-
      Against a live backend holding a few sessions, drive a CONTROL verb (`spex session show <SEL>`) — the
      class that used to take a raw id straight to the backend's exact-match endpoint — with EVERY selector
      shape naming ONE session: its full id, an id-prefix, its node, its branch, and the reference-sigil form
      (`@<node>`). Then the failure shapes: a prefix that hits TWO sessions (ambiguous), and a selector that
      hits none. Also confirm the comma-list convention on a list verb: `spex session ls a,b` == `a b`.
    expected: |
      All five single-target shapes (full id · id-prefix · node · branch · `@<node>`) resolve to the SAME
      session and the verb acts on that one full id — one grammar, one matcher, no per-verb matching. The
      ambiguous prefix fails LOUD (exit non-zero) naming the candidate ids so the caller can disambiguate; a
      no-match fails loud (exit non-zero) with `no such session`, never a silent miss against the backend. The
      comma form `a,b` matches exactly the union `a b` matches (a comma-joined selector is not one literal that
      matches nothing).
    code: spec-cli/src/selectors.test.ts
    related: [spec-cli/src/sessions.ts, spec-cli/src/client.ts]
---
# eval.md — session-selectors

The loss watched is selector-grammar UNIFORMITY: the bug this node removes is control verbs (review/merge/
send/close/show/…) taking a raw id to the exact-match endpoint while only the list verbs understood
prefix/node/branch. Measured YATU through a real control verb (`spex session show`) against a live backend —
the same `resolveClientSession` path every control verb uses — so the ONE matcher (`matchesSelector` /
`resolveSession`) is exercised as a caller hits it, never a re-implementation. The discriminated result shows
up as the CLI's precise exit: `ok` acts, `ambiguous` lists candidates, `none` says no such session. Evidence:
the CLI transcript (`--result`).
