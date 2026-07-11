---
scenarios:
  - name: host-resolves-from-remote
    tags: [backend-api]
    description: >-
      Run the real backend (`PORT=<free> npm run api`) in a checkout whose origin remote is GitHub and
      read GET /api/issues: the stores list offers the `github` forge store and, once the resident cache
      warms, real `github#N` issues appear in the merged list — unchanged pre-seam behaviour. Then make
      the resolved host gitlab (a gitlab-form remote, or `{"forge":{"host":"gitlab"}}` in
      spexcode.local.json), restart, and read the SAME surfaces: /api/issues answers 200 with local
      threads only (no forge store, no `<host>#N` ids, no error) and /api/graph answers 200. Also probe
      the resolver directly across remote shapes: github.com URL → github, gitlab.com scp and a
      self-hosted https form (e.g. dev.aminer.cn) → gitlab, an explicit forge.host override beating the
      remote, and no origin → the default. File the transcript with --result.
    expected: >-
      resolveForgeHost() derives github/gitlab per the ladder (config override > remote hostname >
      DEFAULT_FORGE_HOST); a github repo's issues surface is byte-identical in shape to the hardwired
      era; a resolved host with no registered driver degrades to an empty forge slice — local issues
      intact, stores without a forge entry, 200s throughout, nothing spawned against the wrong host.
    code:
      - spec-forge/src/drivers.ts
---
# yatsu.md — forge-host

Measured through the real product surface (YATU): the actual `spex serve` backend answering
`/api/issues` and `/api/graph` over HTTP under each remote/config shape — never by asserting on the
resolver in isolation alone (the direct probes are auxiliary evidence riding the same transcript).
