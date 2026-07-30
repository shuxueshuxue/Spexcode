---
title: legacy mark-active compatibility
status: active
hue: 280
desc: The byte-exact fixture that identifies the one shipped mark-active revision which composed arbitrary note prose into session.json.
code:
  - spec-cli/hooks/compat/mark-active-sed-v0.fixture
related:
  - spec-cli/hooks/dispatch.sh
  - spec-cli/src/hook-dispatch.test.ts
---

# legacy mark-active compatibility

This node owns the one read-only fixture for the 0.5.2 default `mark-active` script. The bytes are an
identity, not an executable fallback: `dispatch.sh` compares the project handler against them and, only on an
exact match at the standard core path, runs the package's structured implementation instead. The fixture stays
byte-for-byte equal to the faulty shipped revision, including its unenforced “note never contains quote”
assumption; changing it would silently widen or disable the compatibility decision. The runtime policy and its
no-tracked-write guarantee are owned by [[dispatcher-runtime]].
