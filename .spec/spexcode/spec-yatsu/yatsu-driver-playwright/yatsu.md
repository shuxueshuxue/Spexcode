---
scenarios:
  - name: web-capture-reuses-global-playwright
    driver: manual
    target: spec-yatsu/src/driver-playwright.ts — the playwright web driver
    steps:
      - resolve the machine-global Playwright (CLI on PATH, chromium cached) — no per-package dep, no browser download
      - launch real chromium, open a simple local http page, replay `waitfor: #hi`, capture a settle-aware fullPage PNG
      - confirm the bytes are a valid PNG (magic 89504e47) — proven by the gated real-chromium smoke in driver-playwright.test.ts
      - run `spex yatsu eval` on a `driver: playwright` web scenario — the blob lands in the common-dir cache, a reading in the sidecar
---
# yatsu.md — yatsu-driver-playwright

This node's behaviour is the **first real producer** behind the Driver seam, observed at the engine level
(manual driver) so a bare `spex yatsu eval` sweep stays safe with no live server. The genuine browser
capture is proven by this node's own **real-chromium smoke** (a tiny local http page → a valid PNG) and by
a live `spex yatsu eval` of a `driver: playwright` scenario, which drives the actual product loop:
driver → content-addressed blob in the shared cache → reading in `yatsu.evals.ndjson`.

A live-target playwright scenario is deliberately NOT committed here: until eval is hardened so one
producer's capture failure can't abort a tree-wide sweep, a down target would crash every node's eval. An
executable web scenario looks like this (run it explicitly against a running app, e.g.
`YATSU_BASE_URL=http://localhost:5173 spex yatsu eval <node>`):

```
scenarios:
  - name: dashboard-loads
    driver: playwright
    target: /
    steps:
      - waitfor: .board
      - click: "[data-node]"
      - waitfor: .spec-body
```
