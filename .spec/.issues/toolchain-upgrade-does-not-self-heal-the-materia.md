---
concern: toolchain upgrade does not self-heal the materialized renders: the auto-materialize gate keys on .config content only, so after updating spexcode (npm global or source) the stale renders stay until a manual spex materialize. Key the gate on toolchain version too, so an upgrade re-renders on the next harness event.
by: 1a47519f-6024-419d-ac56-4814e289b86a
status: open
nodes: harness-delivery
created: 2026-07-11T11:50:17.793Z
---

(no detail given — toolchain upgrade does not self-heal the materialized renders: the auto-materialize gate keys on .config content only, so after updating spexcode (npm global or source) the stale renders stay until a manual spex materialize. Key the gate on toolchain version too, so an upgrade re-renders on the next harness event.)
