---
title: eval remark records
status: active
hue: 140
desc: The single shared record shapes for eval remark threads, replies, and their scenario join; consumers import them rather than copying them.
code:
  - spec-eval/src/remarks.ts
---
# eval remark records

`remarks.ts` owns the `Reply`, `Issue`, and `RemarkTrack` shapes once. The CLI imports and re-exports these types
for its issue surface; it does not define a second copy. The record module contains no CLI storage or parsing,
so the independent eval package can expose the same shapes without reversing the package boundary.
