---
title: eval host port
status: active
hue: 140
desc: spec-eval's host boundary fails loudly for required CLI capabilities while allowing a standalone empty remark-track downgrade with explicit limits.
code:
  - spec-eval/src/host.ts
---
# eval host port

`host.ts` is the one host boundary for the public eval package. Session review identity and payload are required
for session evaluation; CLI capabilities fail by named field when the command reaches one without an installed
host. The remark-track loader is intentionally optional for standalone eval: an empty map preserves declarations,
readings, freshness, scores, and content revisions, while remark replies, dangling tracks, and remark-derived
review context are unavailable. The raw issue bytes remain fingerprint input without importing or copying the
CLI parser.
