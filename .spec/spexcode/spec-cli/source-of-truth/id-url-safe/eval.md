---
scenarios:
  - name: colliding-node-detail-populates
    description: >
      In the running dashboard, open a spec node whose leaf basename collides with another node's, so
      the loader mints a disambiguated id (e.g. either `spec-scout` node → `.config_spec-scout` /
      `injected-context_spec-scout`). Focus it via the search palette, open its info popup, and read the
      spec, history, and eval panes. Cross-check the backend directly: `GET /api/specs/<id>/content`.
    expected: >
      Every pane populates with the node's real content — the spec body renders, history shows version
      rows, the eval pane resolves — with NO empty panel and NO 404. The disambiguated id is one path
      segment, so `/api/specs/.config_spec-scout/content` returns 200; the pre-fix `/`-joined form
      `/api/specs/.config/spec-scout/content` returns 404 (the `/` split the `:id` route).
    tags: [frontend-e2e]
    related:
      - spec-dashboard/src/data.js
      - spec-dashboard/src/NodeView.jsx
---
# measuring id-url-safe

YATU through the real product: drive the actual dashboard (search palette → node-info popup) to open a
colliding-basename node and confirm its detail panes populate, and hit the real `/api/specs/:id/*` routes
to confirm the disambiguated single-token id resolves where the old `/`-joined id 404'd. The loss is any
empty panel, spinner-that-never-resolves, or 404 for a node the tree can point at.
