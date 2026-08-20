---
scenarios:
  - name: close-dirty-work-round-trip
    description: >
      Through the real HTTP close and resume endpoints, create a session with tracked and untracked dirty
      files, close it, inspect the archive ref/worktree/branch/record, then resume it.
    expected: >
      Close proves the exact cold stop, publishes refs/spex-archive/<id> before removing the worktree, keeps the
      branch and record, and resume rebuilds the worktree with both dirty files unchanged before relaunching.
    tags: [backend-api, cli]
  - name: close-ref-publication-failure-is-loud
    description: >
      Make the archive ref update fail while closing a dirty session through the real HTTP endpoint.
    expected: >
      Close fails loudly and leaves the worktree, record, branch, and dirty bytes untouched; no close projection is
      published and no resource is removed.
    tags: [backend-api]
  - name: close-refuses-an-active-turn
    description: >
      Drive close against a real backend fixture whose native adapter reports an active descendant turn.
    expected: >
      Close refuses before any interrupt or deletion, naming the active turn and retaining every owned resource.
    tags: [backend-api, cli]
  - name: legacy-archived-row-is-readable
    description: >
      Load an existing archived:true record with its historical coldProof and no worktree, then read and resume it
      through the real backend.
    expected: >
      The legacy row projects as closed/offline, remains readable, and resume reconstructs its branch worktree and
      launches the same conversation without requiring a new archive ref.
    tags: [backend-api, frontend-e2e]
  - name: close-conversation-transcript-remains-readable
    test: spec-dashboard/test/session-surface-cold-readable.e2e.mjs
    description: >
      Use real Chromium against a live backend to close a session, select its closed row, read its timeline, and
      expand a transcript interval after the worktree has gone away.
    expected: >
      The closed row leaves the default board but remains in the shelf projection. Conversation keeps the same
      disabled cold shell, transcript details load lazily once and cache on re-expand, and the footer resume action
      reaches the real /resume endpoint.
    tags: [frontend-e2e, desktop, backend-api]
---

# eval — close

YATU: measure close through the real HTTP/CLI and Chromium surfaces. A close is a soft terminal transition: exact
cold proof plus archive-ref publication, worktree removal, and retained branch/record/transcript. There is no
permanent-delete action in this node. Historical `archived:true` rows are compatibility fixtures and are measured as
closed projections.
