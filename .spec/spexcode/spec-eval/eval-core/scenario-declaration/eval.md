---
scenarios:
  - name: closed-schema-and-tag-library-refuse-loud
    tags: [cli]
    code: [spec-eval/src/scenarios.ts#validateScenarios]
    description: >
      Run `spex eval lint` over eval.md files carrying, one at a time: a missing required field, an unknown key,
      a duplicate scenario name, a ghost `code`/`related` path, a dead and an ambiguous `path#symbol` selector,
      and a tag outside `lint.scenarioTags`. Then add that tag to the library and re-run.
    expected: >
      Each is one `eval-schema` finding naming the offending scenario and its repair, never a silently reshaped
      declaration; the out-of-library tag names both repairs (pick an existing tag, or extend the library), and
      extending the library clears it. The scan exits zero because the measurement layer is advisory.
  - name: fixed-tree-projection-and-its-write-inverse
    tags: [cli]
    code: [spec-eval/src/scenarios.ts#scenarioProjection, spec-eval/src/scenarios.ts#writeScenarioMeasurementMetadata]
    description: >
      Read `spex eval scenario ls --json` on a clean tree, then edit only a scenario's `test`, then only its
      `description`. Separately, pipe an eval.md through `spex eval scenario write --mutation` to insert a `test`
      and then to delete it.
    expected: >
      A test-only edit moves `fullIndexHash` but not `semanticIndexHash`; a description edit moves both;
      `--unmeasured` with `--json` fails loud. The insert places `test` after `tags` keeping indentation and line
      endings, and the delete reconstructs the authoritative input bytes byte-for-byte, comments and blank lines
      included.
---
# measuring scenario-declaration

Both scenarios drive the real CLI over authored bytes; the write seam's proof is byte equality of its own inverse.
