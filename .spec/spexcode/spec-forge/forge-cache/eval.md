---
scenarios:
  - name: gitlab-resident-projection
    tags: [backend-api]
    code: spec-forge/src/cache.ts
    related: [spec-forge/src/resident.ts, spec-cli/src/reviews.ts]
    description: >-
      In a real GitLab-hosted checkout whose existing credential source can read the adopter-a project, record
      only the direct GitLab REST and `gitlabDriver.listIssues()` counts. Run an explicit branch-local
      backend (`PORT=<free> env -u SPEXCODE_API_URL npm run api`), seed its resident read with
      `GET /api/issues?q=store:gitlab`, then poll that same endpoint without a restart while the resident
      reconcile completes.
    expected: >-
      The HTTP Issue store eventually carries the same non-zero GitLab count and `gitlab#<iid>` identities
      as the authenticated REST/driver reads. A cold response may carry the last empty resident state, but
      a later cache-content revision republishes the unified snapshot; it cannot remain at zero after the
      driver has returned the live rows. Counts and failure layers are recorded without token or credential
      output.
  - name: resident-delta-freshness
    tags: [backend-api]
    code: spec-forge/src/cache.ts
    related: [spec-forge/src/resident.ts, spec-cli/src/issues.ts]
    description: >-
      Run a throwaway backend (`PORT=<free> env -u SPEXCODE_API_URL npm run api`) in the live repo and let
      the resident cache seed (GET /api/issues shows the forge slice). Then, WITHOUT restarting: create a
      real forge issue through the product (`spex issue open --store github` or POST /api/issues), and
      close another via `spex issue close github#N`. Poll GET /api/issues across the resident TTL window.
      Clean up the scratch issue.
    expected: >-
      The new issue appears and the closed one flips state in the server's merged read within the
      incremental cycle — the updated-since window feeding applyIssues (an upsert merge: an issue never
      leaves the set, a closed one updates in place) — with NO cold full pull per look and no backend
      restart. The server's post-write read-back also forces the slice, so the answering response already
      reflects the store-authored state. The view stays a recompute over the cached set (one answer — no
      rival incremental resolution), and nothing ever writes a node's version or status.
---

# measuring forge-cache

YATU through the resident cycle in the real backend: real forge writes through the product verbs, the
server's /api/issues merged read as the observed view, the TTL/incremental window as the mechanism under
measurement. The delta≡reconcile invariant itself is additionally exercised by the co-located
cache.test.ts as auxiliary evidence riding the transcript — the product-level reading stays the HTTP
freshness walk.
