---
scenarios:
  - name: agent-publishes-a-live-loopback-service-through-cli
    tags: [cli, backend-api]
    test: spec-cli/src/session-web.api.test.ts
    description: >-
      In an isolated initialized project, create a real session record and a loopback HTTP/WebSocket service.
      Run the public `spex session web add`, `ls`, and `retract` commands, then request its gateway route,
      change the service response, request it again, and request guessed and unavailable routes.
    expected: >-
      Posting stores only one canonical loopback URL and makes no service request. The host gateway checks the
      current published membership before connecting, streams both current HTTP bytes and WebSocket upgrades,
      refuses a guessed key with 403 without contacting any service, and reports a stopped published target as
      502. Retract removes only that URL.
  - name: dashboard-opens-and-refreshes-published-resource-tabs
    tags: [frontend-e2e, cli, backend-api]
    test: spec-dashboard/test/session-web.e2e.mjs
    description: >-
      With a real served dashboard already viewing a live session, use the real CLI to post a local webpage
      while its service changes each response. Inspect the automatically opened iframe tab, refresh it, open a
      posted file through the trailing plus picker, close and reopen the web tab, then retract the web URL.
    expected: >-
      The webpage is rendered in a same-origin iframe without a download or separate tunnel; refresh fetches
      a newer service response. The plus picker creates exactly one tab per posted reference, skips references
      already open, and permits reopening a closed tab. A retraction reaches the graph and removes its web tab.
---

# web - eval

Measure the CLI, proxy, and browser together. The important proof is a current local response reached through
the published-key authorization route, not a copied page or a direct browser visit to the loopback port.
