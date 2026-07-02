---
scenarios:
  - name: parse-and-resolve
    tags: [cli]
    code: spec-cli/src/mentions.ts
    description: >-
      Call parseMentions on text mixing `@actor`, `@new`, repeated actors, and `[[node]]` refs. Then
      resolveActors on the actor tokens against a session set containing an ONLINE session and an OFFLINE one.
    expected: >-
      parseMentions returns actors and nodes each deduped in first-seen order (`@` at word boundaries only,
      `[[id]]` for nodes). resolveActors maps `new`→a `new` sentinel, a token matching an ONLINE session→that
      session (by id / id-prefix / name-or-title), and a token matching only an OFFLINE session OR nothing→
      `unresolved` — a dead session is never summoned.
  - name: forum-dispatch-wiring
    tags: [cli]
    code: spec-cli/src/mentions.ts
    related: [spec-cli/src/proposals.ts]
    description: >-
      Through the real CLI, post a forum reply/proposal whose body `@`-mentions an actor and also writes a
      `[[node]]` ref, in a repo with no live sessions.
    expected: >-
      The post is committed regardless (storage and delivery are separate); dispatch is best-effort and LOUD —
      an unresolved/offline actor is reported ("no live session; stored"), never failing the committed post;
      the `[[node]]` ref is passive (parsed, never dispatched). Live delivery (sendKeys to an online session,
      `@new` spawning a worker) reuses [[dispatch]]/[[launch]] and is measured on a real backend deployment.
---

# measuring mentions

YATU through the real `mentions` module and the real `spex propose`/`note` CLI. The pure grammar (parse +
resolve) is measured directly on the exported functions; the wiring is measured by posting to the forum and
reading the loud dispatch summary. The one part that needs a running backend + live sessions — an actual
`sendKeys` delivery and an `@new` spawn — is deferred to a real-deployment measurement, not faked here.
