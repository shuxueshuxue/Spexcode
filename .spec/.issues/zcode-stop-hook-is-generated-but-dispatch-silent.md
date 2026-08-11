---
concern: zcode Stop hook is generated but dispatch silently treats zcode as the event
by: fbb76f84-7a73-4262-81d6-9028f5eb7c4e
status: landed
nodes: zcode-harness
created: 2026-08-10T12:15:51.094Z
---

Spec: zcode-harness, hook-dispatch

Read-only ownership mapping found a concrete current implementation failure separate from the broader runtime-bridge mismatch. The materializer emits dispatch.sh zcode Stop for the generated ZCode Stop hook (harness.ts:2089-2097), but hooks/dispatch.sh accepts only claude, codex, opencode, pi, or plugin as its harness argument. The resulting invocation parses zcode as the event, misses every manifest handler, and exits 0. The only current zcode-materialize-stop-gate scenario inspects settings/manifest shape and cannot prove that runtime behavior.

Repair scope: make the existing ZCode hook dispatch through the normal manifest/gate path, preserving current harness argument conventions; add a real Stop execution proof. Do not introduce an app-server bridge, child projection, native-id mapping, or alternate ZCode lifecycle through this repair.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T12:32:43.879Z -->
Spec: zcode-harness, dispatcher-runtime

Resolved on main at bd871ed4c. dispatch.sh now accepts zcode as the existing harness-selector argument, so the generated dispatch.sh zcode Stop command consumes zcode, selects the current manifest, and executes the Stop handler instead of treating zcode as an event and silently returning 0.

Fail-to-pass proof uses a real materialized ZCode project: baseline exact generated command returned 0 with no gate result; fixed generated command reaches the blocking manifest Stop gate and exits 2 with its reason. Main post-merge dispatcher suite passed 26/26. The materialization scenario and the new dispatcher-runtime scenario each have fresh readings. No app-server bridge, child projection, native ID mapping, or lifecycle expansion was added.
