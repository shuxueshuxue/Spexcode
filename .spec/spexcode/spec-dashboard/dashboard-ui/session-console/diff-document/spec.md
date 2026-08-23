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
virtualized editor and source line numbers, and folds naturally by file section.

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
a second navigation or transport mechanism. The shell's conversation|terminal|diff switcher replaces the URL while
the tab remains `#/sessions/<id>`. Terminal and conversation remain the other two session faces.
