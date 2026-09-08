---
title: evidence-kind-taxonomy
status: active
hue: 275
desc: Evidence bytes are served with a MIME type derived from their content, so image, video, structured data, text, and binary files render honestly through the shared evidence surface.
code:
  - packages/spec-core/src/evidence.ts#sniffBlobMime
related:
  - spec-cli/src/index.ts
  - spec-dashboard/src/Evidence.jsx
---
# evidence-kind-taxonomy

The evidence route answers one question from the bytes themselves: how should a browser render them? PNG,
JPEG, GIF, and WebP are image media; WebM and ISO-BMFF files are video; valid JSON text is structured data;
other non-binary text is plain text; and bytes containing NULs or another unrecognised signature are served as
binary. The content-addressed hash never changes with this classification.

The CLI and dashboard use the same `sniffBlobMime` result. A body link such as
`![frame](/api/evidence/<hash>)` therefore renders through the shared evidence component without adding a
kind field to the issue or remark record. A missing blob remains an explicit 404 rather than an empty render.
