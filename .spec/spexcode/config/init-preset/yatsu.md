---
scenarios:
  - name: fresh-adopter-measures-unprompted
    description: >
      `spex init` a scratch git project OUTSIDE this repo (default preset), then dispatch ONE real worker
      with a plain frontend task that contains ZERO measurement words (no "yatsu", "measure", "evidence",
      "screenshot", "video"). Observe, through the real product, whether the seeded contract + Stop nudge
      drive the worker to autonomously (a) create a yatsu.md scenario for the node it changed and (b) file
      a real, evidenced yatsu reading — WITHOUT the task ever mentioning measurement.
    expected: >
      The default-preset materialized contract carries the measurement discipline, so the worker ends with
      a yatsu.md (≥1 scenario) AND at least one filed reading whose evidence is a real product observation
      (a browser DOM read + screenshot, an API transcript, etc.) — not a hasYatsu:false / 0-readings blind
      spot. Zero loss = the loss signal is NOT blind on a fresh adoption; the worker measured on its own.
    tags: [cli]
---
# measuring adoption's loss signal

YATU: do the real adoption loop, not a desk-check of the templates. `spex init` a throwaway repo, start a
governed backend over it, dispatch a real worker (the same launcher an adopter uses) on a plain frontend
task, and read the FIXTURE's own `.spec` + `spex yatsu show <node>` afterwards — the durable proof is the
worker's filed reading (verdict + evidence), captured from the running product, exactly as an adopter's
board would show it. A pass here means adoption itself now produces a measured signal.
