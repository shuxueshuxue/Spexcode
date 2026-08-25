---
scenarios:
  - name: retraction-restores-the-previous-reading-everywhere
    tags: [cli]
    code: [spec-eval/src/sidecar.ts]
    description: >
      File two readings for one scenario, then `spex eval retract --last`, then retract again. After each step
      read the sidecar bytes, `spex eval ls`, `spex eval lint`, and the clean command's referenced-blob set.
    expected: >
      No line is ever deleted or rewritten — each retraction is appended and carries `retracts` — while every
      consumer reads the same effective view: the previous reading becomes latest, then the scenario honestly
      returns to `eval-missing`, and the withdrawn readings' blobs fall out of the referenced set. A retraction
      matching no reading is inert and a retract with nothing to withdraw fails loud.
---
# measuring reading-sidecar

The append-only claim is measured on the bytes, and the effective-view claim on every surface that folds them.
