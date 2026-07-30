---
scenarios:
  - name: gitlab-resident-projection
    tags: [backend-api]
    code: spec-forge/src/cache.ts
    related: [spec-forge/src/resident.ts, spec-cli/src/reviews.ts]
    description: >-
      Run `npx tsx --test spec-forge/src/resident.api.test.ts` from this branch. The test creates a tiny
      Git repo whose remote resolves to a local GitLab REST fixture, starts this branch's backend entrypoint,
      and holds the driver's seven-row issue response until the first
      `GET /api/issues?q=store:gitlab` has published its resident snapshot. Release the fixture, then read
      the SAME API path again without a restart.
    expected: >-
      The first API read is zero while the fixture response is held; the second carries exactly seven
      `gitlab#<iid>` rows after the production driver reconciles. The cache-content revision republishes the
      unified snapshot; it cannot remain at zero after the driver has returned live-shaped rows. A real
      credentialed z-code probe is separate A evidence and is never substituted by this deterministic B.
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
