---
title: review
status: active
seed: false
hue: 200
desc: Grouping shelf for the `surface: review` prose presets — remark templates the backend lists at `/api/plugins?surface=review`; no dashboard composer fetches them now. A shelf, not a surface — routing stays field-driven per [[surface]].
---
# review

The **review-track** prose presets live here: leaf plugins whose body is a remark template. The backend
lists them at `/api/plugins?surface=review`; the dashboard's `loadReviewPlugins` helper exists for that
route and nothing calls it, so no composer offers a `/<name>` menu now. Were one to, picking a preset would
prefill the composer and the result would be an ordinary remark on the (node, scenario) thread; a preset
adds prose, never a write mechanism.

This node is a **shelf, not a surface**. Its routing and relocation invariant is owned once by
[[.plugins]]'s shelf invariant. First resident: [[refuse]], a structured objection to a scenario's verdict —
a subject with no reading behind it now.
