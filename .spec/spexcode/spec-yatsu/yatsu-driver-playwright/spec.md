---
title: yatsu-driver-playwright
status: active
hue: 140
desc: The first REAL evaluation producer behind the Driver seam — a Playwright web driver that reuses the machine-global Playwright to open a scenario's target, replay its steps, and capture a settle-aware screenshot, wired as `driver: playwright`.
code:
  - spec-yatsu/src/driver-playwright.ts
---
# yatsu-driver-playwright

## raw source

The first REAL producer behind [[yatsu-core]]'s Driver seam: a Playwright **web** driver. It launches a
real browser by REUSING the machine-global Playwright already on the box (never bundling one or downloading
a browser), opens the scenario's target URL, replays its steps, and captures a settle-aware screenshot — the
bytes eval stores in the cache and records in the sidecar. Web apps only; Electron is a separate node.

## expanded spec

A scenario declaring `driver: playwright` is read by this producer. Its `target` is the URL to open: a full
http(s) URL as-is, a bare path resolved against `YATSU_BASE_URL` (the app under test). Any other scheme is
rejected — the driver is WEB-only, so Electron and other surfaces belong to their own driver nodes.

Two replay modes, one screenshot per reading:
- inline `steps` — the driver owns a real chromium page: navigate, replay, capture. A step in the compact
  `verb: arg` form (goto / click / fill / press / wait / waitfor) is EXECUTED; prose ("click the logout
  button") is narration — recorded intent a human or a future computer-use driver acts on, never silently
  mis-parsed as a selector. So a prose-only scenario still yields a reading: the target's settled landing
  state. A malformed executable step fails loud.
- a `run` path — the native `@playwright/test` file IS the scenario body; the global test runner executes it
  (owning its own browser) and the screenshot it produces is harvested as the blob. A non-zero run is a real
  loss: it throws, never a green reading over a red run.

The capture is **settle-aware** — after navigation and steps it waits (bounded) for the network to go idle,
so the pixels reflect a quiesced page rather than a mid-load frame.

**Reuse, never bundle.** This package adds no playwright dependency and downloads no browser. The
machine-global install (CLI on PATH, chromium already cached) is THE install, resolved at capture time;
because resolution is lazy, a manual-only run that merely imports the registry never touches playwright.
Absent everywhere, it fails loud with the one-line repair command.

**Wiring.** The driver registers itself in [[yatsu-core]]'s `drivers.ts` registry — the one anticipated edit
the seam was built for; eval is unchanged — so `spex yatsu eval` uses it for any web scenario.

Out of scope (sibling nodes): the **Electron** driver, WebDriver, and hardening eval so one producer's
capture failure can't sink a tree-wide sweep. Until that lands, a live-target playwright scenario is kept
out of the shared `yatsu.md` (a down target would otherwise crash a bare `spex yatsu eval` for every node).
