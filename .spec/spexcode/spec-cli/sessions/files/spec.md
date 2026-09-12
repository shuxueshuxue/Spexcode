---
title: files
status: active
hue: 165
desc: A session-owned list of live file paths — what the agent publishes, and the uploads a human sends it — that the dashboard can preview and download on demand.
code:
  - spec-cli/src/session-files.ts
related:
  - spec-cli/src/cli.ts
  - spec-cli/src/help.ts
  - spec-cli/src/index.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/guide.ts
  - spec-cli/src/session-files.api.test.ts
  - spec-cli/src/uploads.ts
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/ResourcePicker.jsx
  - spec-dashboard/src/resourceCatalog.js
  - spec-dashboard/src/icons.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/i18n/en.js
  - spec-dashboard/src/i18n/zh.js
  - spec-dashboard/test/session-files.e2e.mjs
  - spec-dashboard/src/fileRefs.js
  - spec-dashboard/src/fileRefs.test.mjs
  - spec-dashboard/src/Transcript.jsx
  - spec-dashboard/src/TimelineChat.jsx
  - spec-dashboard/src/SessionTerm.jsx
---
# files

An agent hands an artifact to the human by publishing its path, not its bytes. Each session owns one
global-store `files.json` beside its `runtime.json`; its JSON array of absolute paths is the complete,
durable state. Posting, listing, and removing edit only that list. They never copy, move, stage, or upload
the target, so a listed path remains a live reference and may point anywhere the session host can reach.

## one list, three operations

The agent-facing porcelain is `spex session files add <path>`, `spex session files ls`, and
`spex session files retract <path>`. `add` resolves a relative input against the caller's current
directory and stores the resulting absolute path exactly once, but only while it names a readable regular file;
a missing, unreadable, or non-file target is refused before the list changes. `ls` reads every registered path
and marks a target that has since disappeared or become unreadable as invalid rather than printing it like a
working handoff; `retract` removes that exact resolved path. The spelling follows the shared CLI vocabulary: `add` appends a record, `ls` reads a
collection, and `retract` withdraws the author's published record. All three operate on the calling agent's
session, so an agent needs only its artifact path to publish it.

The reference is intentionally host-local. An absolute path preserves the location the posting agent meant
even when a later CLI command has another cwd; a copied session record on another machine cannot make that
path portable, and therefore reports a missing file rather than silently resolving a different local path.
Raw run artifacts default to a persistent directory outside the product repository. Putting them in the
worktree makes the merge-readiness dirty-tree gate demand that generated evidence be committed as product
source, while this repository deliberately does not accept raw run artifacts. Before review, the publisher
checks every registered path still exists; `ls` is the product read that makes a broken handoff visible.

## download is the only byte transfer

The session API projects the posted list to the dashboard. Its one file route accepts a session id and a
path from that same list, reloads the list at request time, and streams the target through the existing
backend response only after exact membership succeeds. `preview=1` selects inline preview headers on that
same route; it is not a second reader or a cached copy. Both modes are `no-store`, so each request opens the
current target bytes. The route never accepts an arbitrary filesystem path, and it does not turn a path into
an uploaded artifact. A list entry that has since been deleted, moved, or become unreadable remains visible
as the honest published reference, but its preview or download returns a named `404 file no longer exists`
error. A path absent from the current list is a named `403` before the backend asks the filesystem about it,
whether or not it exists on the host. Membership therefore remains the authorization boundary without turning
the route into an existence oracle for arbitrary backend paths.

## preview is safe and bounded

Clicking the filename opens or selects that path's existing [[session-console]] resource tab; it never
creates a second pop-out reader. Its neighbouring download tool retains the direct download, while the copy
tool remains the only control that exposes the absolute path. Preview renders
raster PNG, JPEG, GIF, or WebP images, and text extensions as text. `.md` and `.markdown` use the dashboard's
existing restricted Markdown renderer; every other text extension stays verbatim. Standalone `.html` and `.htm`
files render in an unrestricted iframe: scripts execute and the document retains ordinary browser capabilities,
including same-origin access to the dashboard. HTML preview is therefore an execution surface, not a security
boundary; a posted HTML file is trusted code. Raw HTML inside Markdown remains text rather than executable dashboard
markup. Text is served as `text/plain`; the resource tab is
selectable/copyable and top-anchored, so a newly opened long file begins at byte zero rather than centring and
clipping its first lines. Images arrive as a response blob in an image element. SVG, PDF, archives,
binaries, and unknown extensions have no preview and answer a named
`415` directing the human to download them. That restricted set costs convenient PDF/SVG viewing, but keeps
the preview contract explicit instead of relying on whatever renderer the browser happens to choose.

Preview refuses a file larger than **16 MiB** with a named `413` that states the ceiling and actual size; it
never truncates. The cap keeps a published multi-gigabyte artifact from becoming a browser allocation, and it is
set where it is because a review report is one self-contained HTML page with its screenshots inlined: a dozen
real screenshots already weigh about 1.2 MB once base64-encoded, so a 2 MiB ceiling refused ordinary reports. The
human may still download any posted file regardless of its previewability or size.

## the human's own uploads

The list also holds what the human handed the session. A file the human attaches to a prompt reaches the backend
as a completed upload whose path the prompt carries ([[file-attach]]); when that prompt arrives — as a new
session's first prompt or as a message to a running one — every completed upload it names that still exists is
posted to the receiving session's list, once. That makes the prompt the record of which session received which
upload, so an attachment the human removed from the draft before sending is not posted, and one sent to two
sessions is posted to both. Any other path a prompt mentions is left alone: this is not a way to post arbitrary
host paths, and the download route's membership check is unchanged.

The upload's origin is not a stored flag. A path directly in the upload sink under the completed name the sink
writes is by construction the human's upload, and the session projection reads it back as `uploadedFiles` — the
path, the name the human gave the file, and when it arrived — beside the plain `files` list, so the dashboard can
mark it as theirs and show its own name rather than the sink's collision-proof one. The posting follows the
prompt's acceptance and never holds or fails it; it waits for the session record's lock like any other list
write, and a failure is logged by the backend.

## dashboard handoff

The session document's floating [[resource-picker]] is the dashboard's handoff surface for this list. It is live
whether or not anything is posted, and with nothing posted it says where files come from. Each row shows the
file's name, a folder only where two posted names collide, and the human's own uploads marked as such; the full
absolute path is exposed only on the row's copy-path tool, preserving the useful host-local detail without turning
the list into a path dump. Picking the row opens or selects that path's singleton resource tab
([[resource-tabs]]). Its download tool starts the download, and its copy tool writes the absolute path. With
that file tab selected, the same download and copy-path actions join its right-side toolbar group beside refresh;
the picker and tab intentionally call one action path, so their authorization check and failure message cannot
drift. Preview errors appear inside that tab, not in a second overlay. No browser fetch happens merely because
the picker opened. A failed download is shown as a concrete session action error, while a preview refusal is
shown inside the selected resource tab, never mistaken for file content.

## pointing at a posted file

Prose points at a posted file as `[[file:<name>]]`. The name is the file's own name, or as much of the end of its
path as no other path on the same session's list shares — the way a spec id is its shortest disambiguating path
suffix. `spex session files add` prints the exact reference under the posted path, worked out against the list as
it stands after the add, so an agent never has to guess it. The reference is a name rather than a path: it reads
cleanly in a note and exposes nothing host-local.

It resolves against the list of the session whose text holds it, and only when exactly one posted path equals it
or ends with `/<name>`. In the dashboard a resolved reference is a door to that file — the same resource tab the
files menu opens, reached by ordinary navigation to its address ([[resource-tabs]]) — from the Conversation's prose
([[conversation]]) and from the live terminal pane, where it is read off the screen the way a `[[node]]` is
([[mentions]]). The phone face has no resource tabs, so there it opens the file's preview page in a browser tab. A
reference that no posted path answers to, or that more than one does, stays visibly unresolved and opens nothing:
the list can change after the reference was written, and a guess at which file was meant is worse than saying so.

## agent awareness

The always-materialized system contract mentions the capability in one short operational line: after producing
an artifact worth handing back, an agent publishes its path with `spex session files add <path>` and points at it as
`[[file:<name>]]`. Detailed usage stays in `spex guide files`; the prompt advertises the capability without
becoming a second manual. Review evidence goes out as one self-contained HTML report rather than a stream of
loose files; [[review-report]] is the skill that says how, and the report is posted like any other file.

The guide teaches the three CLI operations, the fact that the path is live and host-local, and that the
dashboard downloads only on click. It explicitly distinguishes this from [[file-attach]], which sends human
bytes to a worker; files sends an agent-owned path to a human — and tells the agent that what the human sends it
is listed here too.
