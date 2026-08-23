---
title: diff-document
status: active
hue: 205
desc: A per-session branch diff document with read-only CM6 files and durable line comments sent through the session channel.
code:
  - spec-dashboard/src/DiffDocument.jsx
related:
  - spec-dashboard/src/readSafety.test.mjs
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
virtualized merge editor. Each file has a panel entry with its status and addition/deletion counts, and the reader
can switch between a synchronized split view and a unified view. Both views use old/new line numbers, collapse long
unchanged stretches, highlight changed words, and syntax-highlight source (including deleted fragments in unified
mode). A wrap toggle and previous/next hunk controls stay inside the same file surface. The endpoint remains the
bounded unified-patch transport; the browser projects each loaded hunk into old/new editor documents instead of
creating a second transport or eagerly fetching every file.

A reader can click a changed line to author a comment. Comments live in the session record as `{filePath,
lineStart, lineEnd, body, diffIdentity, sentAt}`. Saving or editing a comment always clears `sentAt`; sending
un-sent comments formats them as one review message and uses the existing session input/send path. The send
operation marks the exact comments sent under the record lock, so an edited comment is never silently re-sent.
Sent comments remain inline in the diff with their delivery marker.

An empty file list is not itself a claim that the branch authored nothing. The header spells the full branch
and base ref names and full object ids. When the branch head is already an ancestor of the base head, the empty
state says the work is **merged into the named base**, and links the branch head to the forge commit when the
origin remote can provide an honest URL. Only an unmerged head whose merge-base diff is genuinely empty says
there are no branch changes. The UI derives this distinction from the backend's git ancestry result; it never
guesses from `files.length` or shortens the only identities a reader is given.

The diff face is a surface of the session object tab, uses the existing i18n and icon vocabulary, and never creates
a second navigation or transport mechanism. The document-actions slot owns a compact `file-diff` icon toggle with
`aria-pressed`; entering or leaving it replaces the URL while the tab remains `#/sessions/<id>`, and leaving returns to
the remembered Terminal or Conversation base face. Terminal and conversation remain the other two session faces.
