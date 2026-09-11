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
  - spec-dashboard/src/diffTree.js
  - spec-dashboard/src/diffTree.test.mjs
  - spec-dashboard/test/diff-scroll-survives-refresh.e2e.mjs
  - spec-dashboard/test/diff-review-chrome.e2e.mjs
  - spec-dashboard/src/DiffMarks.jsx
  - spec-dashboard/src/Segmented.jsx
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
read-only with CodeMirror's virtualized merge editor. Each file has a panel entry with git's status letter and its
addition/deletion tally ([[diff-marks]]) under its scope's heading, and the reader can switch between a synchronized
split view and a unified view. Both views use old/new line numbers, collapse long unchanged stretches, highlight changed words, and
syntax-highlight source (including deleted fragments in unified mode). A wrap toggle and previous/next hunk controls
stay inside the same file surface. The endpoint remains the bounded unified-patch transport; the browser projects
each loaded hunk into old/new editor documents instead of creating a second transport or eagerly fetching every file.

Both split panes belong inside the editor's own width. The merge editor already lays its two columns out as equal
shrinkable columns, so the document adds only the divider between them: any rule that makes the merge view an
intrinsic-width or flex box sizes the pair to the widest line and carries the new side outside the scroll container,
where a reader sees the old text alone and reads it as a diff that did not render. A changed line is tinted in the
dashboard's diff pair ([[diff-marks]]) rather than the editor library's near-transparent, light-only default,
because which lines moved must be legible at a glance on this surface's background in every theme. The endpoint pays for a wide context window per hunk and
the viewer keeps it: it folds only runs longer than a dozen lines and leaves ten on each side of a change, because
a reader judging a change needs the code it sits in, and collapsing to a three-line margin throws away what was
already fetched.

**The reader is in ONE file at a time, and the panel is a tree.** The changed files are the panel's job; repeating
them as an accordion below the open diff was a second navigation of the same list that spent the height the diff
itself needs. So the panel owns selection and the pane owns the file, whose header stays put while its hunks scroll,
because the thing a reader loses inside a long hunk is which file they are in.

The open file's reading position belongs to that file surface. A live graph refresh or another parent render is not
a file change, so it keeps the mounted CodeMirror view and its scroll position; only selecting another file or
changing an editor setting may replace that view. This matters on the live session board, where unrelated session
state continues to arrive while a reviewer is reading a long diff.

The panel is a DIRECTORY TREE rather than a list of paths, because in this repository a path is a bad label twice
over: the tail is the only part that differs, so truncating it makes thirty rows read alike, and the leaf carries
no information either, since the spec graph names every node's file `spec.md`. A tree factors the shared prefix out
and leaves each row the one segment it owns, and a directory holding nothing but one more directory collapses into
its child so a leaf is never pushed a dozen indents to the right. Where a label still has to give — the sticky
header's directories, a collapsed chain — it gives at the FRONT, never at the leaf, and the untruncated path stays
on the row's tooltip. Two changed files never render the same label. Each directory row is the way to reopen one
branch, and a fresh diff load still starts fully expanded so the review opens with every changed path in view.

**The panel is the product's own sidebar, and it says how big the review is.** Its rows are the explorer's rows
([[file-tree]]) on the explorer's ground: an inset band that washes under the pointer and when selected, never an
element's own chrome, because a file listed in a bordered grey box reads as a control rather than a place in a
tree. A file row ends in its tally and status letter, in one column. Each scope is headed in the sidebars' zone
grammar ([[dock-modes]]): the file count in its pod, the scope's name, and the scope's summed tally, with the
uncommitted scope in the attention hue. A heading stays pinned while its own rows scroll under it. The toolbar
carries the whole review's size (how many files, and the summed tally of every listed row), because that is the
first number a reviewer asks for. The panel is a resizable pane ([[resizable-panes]]), clamped so the editor
keeps at least half the width, and it stacks above the editor on a narrow screen.

The second scope is the session's uncommitted work: the tracked edits and untracked additions its worktree holds
but has not committed. It is enumerated from one porcelain status plus one numstat however dirty the tree is, and
read-only — nothing stages, and nothing else may touch the index a live agent is working in, so an untracked file's
size comes from counting its own lines and its patch is rendered against an empty side on demand. This scope is
readable only from the session's OWN worktree directory. The commit-anchored branch scope falls back to the shared
main checkout once that directory is gone, but the working tree must not: a landed session would otherwise show
whoever is working in the main checkout as its own uncommitted changes. When the directory is gone the endpoint
says the working tree is unreadable, and the document shows the branch alone rather than claiming a clean tree.

The diff body is ordinary browser-selectable text: the reader can drag across it and use the native copy/paste
path without the session chrome or a line click stealing the gesture. The line-number gutter is the one explicit
comment door, so authoring a comment never competes with selecting words from the source. The comment is written
in the product's composer shell ([[composer]]), floated like the prose send card and naming the file and line it
will attach to: Enter saves, Shift+Enter breaks the line, and Escape closes the card before anything behind it.
Comments live in the session record as `{filePath, lineStart, lineEnd, body, diffIdentity, sentAt}`. Saving or
editing a comment always clears `sentAt`; sending un-sent comments formats them as one review message and uses the
existing session input/send path. The send
operation marks the exact comments sent under the record lock, so an edited comment is never silently re-sent.
Sent comments remain inline in the diff with their delivery marker. A reload after saving or sending a comment is
not a navigation: the open file stays selected while it still exists, so the reader lands beside the comment they
just filed rather than back on the first file.

A row can also be RETRACTED. A review conversation that only ever appends is not one: a comment landed on the
wrong line, or left behind by a measurement, would otherwise stay on the record forever. Retract removes that one
row under the record lock and names what it removed, and a retract of a row that is already gone is an honest 404
rather than a silent success. It retracts the RECORD's row, never the message that was already delivered — the
agent read that text, and the product does not pretend otherwise.

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

The reader opens in unified mode with line wrapping enabled. Split or unified is chosen with the product's
segmented control ([[segmented-control]]), and wrapping is the same segment standing alone. Wrapping governs
both split panes as well as the unified view, since a line cut off at the pane edge hides the change it holds.
The CodeMirror editor and merge containers inherit the application's paper, ink, and divider tokens so their
loading surface, gutters, and surrounding frame follow the selected dashboard theme, and every colour the merge
package would otherwise paint from its own light defaults is restated in those tokens: the change bars in the
gutter, the line and word tints, and the band a folded run collapses into. That band's words are in the
reader's language. The file header's hunk steppers are icon buttons from the one icon vocabulary.
