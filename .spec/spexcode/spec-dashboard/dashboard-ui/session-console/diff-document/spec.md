---
title: diff-document
status: active
hue: 205
desc: A per-session diff document over the branch's commits and its uncommitted work, with read-only CM6 files and durable line comments sent through the session channel.
code:
  - spec-dashboard/src/DiffDocument.jsx
related:
  - spec-dashboard/src/readSafety.test.mjs
  - spec-dashboard/src/styles.css
  - spec-cli/src/sessions.ts
  - spec-cli/src/index.ts
  - spec-cli/src/session-diff.api.test.ts
  - spec-dashboard/src/sessionSurface.js
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/route.js
  - spec-dashboard/src/tabs.js
  - spec-dashboard/src/SourceView.jsx
---
# diff-document

The session object has a third document face, `#/sessions/<id>?surface=diff`. It answers one question — what has
this session changed — in two scopes the reader never has to reconcile by hand. It reads the session branch against
the recorded fork base (or the source-of-truth branch for legacy records) through one backend diff endpoint. The
endpoint identifies the merge-base and returns per-file unified patches in bounded byte windows; a file selector
names the scope and the path, so one file loads without loading the whole tree. The browser renders each patch
read-only with CodeMirror's virtualized merge editor. Each file has a panel entry with its status and
addition/deletion counts under its scope's heading, and the reader can switch between a synchronized split view and
a unified view. Both views use old/new line numbers, collapse long unchanged stretches, highlight changed words, and
syntax-highlight source (including deleted fragments in unified mode). A wrap toggle and previous/next hunk controls
stay inside the same file surface. The endpoint remains the bounded unified-patch transport; the browser projects
each loaded hunk into old/new editor documents instead of creating a second transport or eagerly fetching every file.

Both split panes belong inside the editor's own width. The merge editor already lays its two columns out as equal
shrinkable columns, so the document adds only the divider between them: any rule that makes the merge view an
intrinsic-width or flex box sizes the pair to the widest line and carries the new side outside the scroll container,
where a reader sees the old text alone and reads it as a diff that did not render. A changed line is tinted in the
document's own red and green rather than the editor library's near-transparent default, because which lines moved
must be legible at a glance on this surface's background.

The second scope is the session's uncommitted work: the tracked edits and untracked additions its worktree holds
but has not committed. It is enumerated from one porcelain status plus one numstat however dirty the tree is, and
read-only — nothing stages, and nothing else may touch the index a live agent is working in, so an untracked file's
size comes from counting its own lines and its patch is rendered against an empty side on demand. This scope is
readable only from the session's OWN worktree directory. The commit-anchored branch scope falls back to the shared
main checkout once that directory is gone, but the working tree must not: a landed session would otherwise show
whoever is working in the main checkout as its own uncommitted changes. When the directory is gone the endpoint
says the working tree is unreadable, and the document shows the branch alone rather than claiming a clean tree.

A reader can click a changed line to author a comment. Comments live in the session record as `{filePath,
lineStart, lineEnd, body, diffIdentity, sentAt}`. Saving or editing a comment always clears `sentAt`; sending
un-sent comments formats them as one review message and uses the existing session input/send path. The send
operation marks the exact comments sent under the record lock, so an edited comment is never silently re-sent.
Sent comments remain inline in the diff with their delivery marker.

The branch scope is a proof over commits, not over a working directory, so the endpoint anchors its git reads at a
root that exists: the session worktree while it is on disk, and the shared main checkout — which holds the
same refs and objects — once the worktree has been removed (landed and cleaned, or reaped). A session whose
worktree is gone therefore still renders its real changes or its merged state. Only when the branch ref is
gone everywhere (or the session never had a branch, or its heads cannot be proven) does the endpoint refuse,
and that refusal is a structured `409 {error, code: 'diff-unavailable'}` — never an unhandled git failure
surfacing as a 500. The browser renders the 409 as a calm localized "diff unavailable" state carrying the
server's sentence, keeping the red error face for real transport failures. The API contract is executable in
`spec-cli/src/session-diff.api.test.ts` (live worktree, never-committed-with-dirty-work, removed-worktree-landed,
vanished-branch), and the browser/backend seam in `readSafety.test.mjs`.

An empty file list is not itself a claim that the branch authored nothing. The header spells the full branch
and base ref names and full object ids, and the backend decides which of three things is true of the branch's own
commits. A branch whose head still stands at its **fork point** has no commits of its own; it is not merged, and it
is offered no forge commit. A branch whose head is a different commit the base already contains is **merged into the
named base**, and its head links to the forge commit when the origin remote can provide an honest URL. Only an
unmerged head whose merge-base diff is genuinely empty says there are no branch changes. Git ancestry alone cannot
separate the first two — a branch that never committed is an ancestor of its base exactly like one that landed — so
the fork point is the deciding fact: the session record carries the commit `git worktree add` started from, and a
record written before that field recovers the same commit from the branch ref's creation reflog entry. Neither
available leaves only what ancestry proves. The UI renders the backend's verdict; it never guesses from
`files.length` or shortens the only identities a reader is given. Because most of a session's life is spent with no
commits yet, calling that state merged is the difference between a surface a reader trusts and one they stop opening.

The diff face is a surface of the session object tab, uses the existing i18n and icon vocabulary, and never creates
a second navigation or transport mechanism. The document-actions slot owns a compact `git-compare` icon toggle with
`aria-pressed`; entering or leaving it replaces the URL while the tab remains `#/sessions/<id>`, and leaving returns to
the remembered Terminal or Conversation base face. Terminal and conversation remain the other two session faces.
