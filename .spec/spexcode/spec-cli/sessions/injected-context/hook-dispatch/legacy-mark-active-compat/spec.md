---
title: legacy mark-active compatibility
status: active
hue: 280
desc: The byte-exact fixtures that identify the two shipped mark-active blobs which composed arbitrary note prose into session.json.
code:
  - spec-cli/hooks/compat/mark-active-sed-v0.fixture
related:
  - spec-cli/hooks/compat/mark-active-0.5.2-eef1.fixture
  - spec-cli/hooks/dispatch.sh
  - spec-cli/src/hook-dispatch.test.ts
---

# legacy mark-active compatibility

This node owns two read-only identities, not executable fallbacks: the incident-captured pre-subagent source
(`c94cb3ec…`) and the exact `eef1e154` 0.5.2 release source (`61246732…`, with its subagent guard). The
release fixture is tested byte-for-byte against that historical Git object. `dispatch.sh` compares a project
handler against either identity and, only on an exact match at the standard core path, runs the package's
structured implementation instead. A package version label is not an identity: the locally retained
`spexcode-0.5.2.tgz` has different, structured bytes and therefore receives no override.

Both fixtures preserve their unenforced “note never contains quote” assumption; changing either would silently
widen or disable the compatibility decision. Any other byte sequence, including a project customization,
executes exactly as the manifest requested. The runtime policy and its no-tracked-write guarantee are owned by
[[dispatcher-runtime]].
