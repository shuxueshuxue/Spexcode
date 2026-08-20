# M4 listener fail-first

The retained raw output is `m4-fail-first.log`. Before adding the materialized node, this Node 22 assertion checked
the baseline hook surface and failed with our own `AssertionError`: the baseline had no `session-listen` node to
compile into a manifest. The assertion is deliberately discriminating; it is not a missing command, import, or
fixture failure. The log is immutable evidence and is not a target of later pass runs.

Command:

```sh
node --input-type=module -e 'import assert from "node:assert/strict"; const baseline = "surface: hook\\nevents:\\n- SessionStart\\n- UserPromptSubmit\\n"; assert.match(baseline, /session-listen/, "M4 fail-first: baseline has no materialized session-listen node");'
```

The log SHA-256 is `d08c6f61b85354b408c7fd7e3db479d88a040b851be17e4b11844a81ea454950`.
