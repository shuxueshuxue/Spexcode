---
scenarios:
  - name: backend-free-self-launch-loop
    tags: [cli]
    description: >
      Initialize a throwaway project, run the real `spex init --harness` and `spex materialize`, install the
      protocol and self-launch adopter from packed tarballs into a consumer outside the repository, then drive
      the loop only through the real shell dispatcher: SessionStart, an enqueue from a separate short-lived
      producer process, and UserPromptSubmit. Assert the listener is bound in the manifest a fresh project
      receives, and that no resident process exists between producing and consuming.
    expected: >
      The listener is present in the manifest the dispatcher actually reads; the address is established and
      re-initialization is idempotent; the harness input seam receives the exact enqueued body; the message
      leaves the queue exactly once and an empty queue emits nothing at exit 0; and the whole loop completes
      with no backend, no wake hint, no resident process, and no governed session record ever existing.
    code: .spec/spexcode/.plugins/core/session-listen/session-listen.sh
    related: scripts/m4-self-launch-yatu.mjs
---

# self-launch cutover loss

Measure the loop the way a self-launching user meets it: a project whose harness artifacts came from the real
init and materialize, a listener reached through the real shell dispatcher, and an adopter installed from a
packed tarball. Reading the listener script, or calling it directly, measures the script rather than the
product — the manifest binding and the harness input seam are exactly the parts that can be wrong while the
script is right.
