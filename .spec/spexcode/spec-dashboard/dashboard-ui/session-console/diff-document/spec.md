---
title: diff-document
status: active
hue: 205
desc: A per-session branch diff document with read-only CM6 files and durable line comments sent through the session channel.
code:
  - spec-dashboard/src/DiffDocument.jsx
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/index.ts
  - spec-dashboard/src/sessionSurface.js
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/route.js
  - spec-dashboard/src/tabs.js
  - spec-dashboard/src/SourceView.jsx
---
# diff-document

The session object has a third document face, `#/sessions/<id>?surface=diff`. It reads the session branch against
the recorded fork base (or the source-of-truth branch for legacy records) through one backend diff endpoint. The
endpoint identifies the merge-base and returns per-file unified patches in bounded byte windows; a file selector
can fetch one file without loading the whole tree. The browser renders each patch read-only with CodeMirror's
virtualized editor and source line numbers, and folds naturally by file section.

A reader can click a changed line to author a comment. Comments live in the session record as `{filePath,
lineStart, lineEnd, body, diffIdentity, sentAt}`. Saving or editing a comment always clears `sentAt`; sending
un-sent comments formats them as one review message and uses the existing session input/send path. The send
operation marks the exact comments sent under the record lock, so an edited comment is never silently re-sent.
Sent comments remain inline in the diff with their delivery marker.

The diff face is a tab-shaped session route, uses the existing i18n and icon vocabulary, and never creates a second
navigation or transport mechanism. Terminal and conversation remain the other two session faces.
