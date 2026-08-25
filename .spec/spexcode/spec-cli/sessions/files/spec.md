---
title: files
status: active
hue: 165
desc: A session-owned list of live file paths that an agent can publish and the dashboard can download on demand.
code:
  - spec-cli/src/session-files.ts
related:
  - spec-cli/src/cli.ts
  - spec-cli/src/help.ts
  - spec-cli/src/index.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/guide.ts
  - spec-cli/src/session-files.api.test.ts
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/icons.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/i18n/en.js
  - spec-dashboard/src/i18n/zh.js
  - spec-dashboard/test/session-files.e2e.mjs
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

Preview refuses a file larger than **2 MiB** with a named `413` that states the ceiling and actual size; it
never truncates. The cap keeps a published multi-gigabyte artifact from becoming a browser allocation. The
human may still download any posted file regardless of its previewability or size.

## dashboard handoff

The selected session's top-right file icon is disabled grey when its projected list is empty. Once at least
one path is posted, the same icon is live and opens a compact, content-sized dropdown. Each row shows only
the file name; the full absolute path is exposed only on its copy-path icon's tooltip, preserving the useful
host-local detail without turning a toolbar menu into a path dump. Long names clip at a viewport-safe bound,
but a short name does not inherit a fixed empty menu width. Every row uses one flexible filename column followed
by two fixed action columns, so copy and download stay aligned to the dropdown's right edge across all posted
paths. The filename itself is the preview target: clicking it opens or selects the same singleton resource tab
that the toolbar's `+` picker opens. Its adjacent download icon starts the download, and its copy icon writes the
absolute path. With that file tab selected, the same download and copy-path actions join its right-side toolbar
group beside refresh; the menu and tab intentionally call one action path, so their authorization check and
failure message cannot drift. Preview errors appear inside that tab, not in a second overlay.
File and resource dropdowns share the app's restrained context-menu chrome:
a real border plus shallow ambient depth, never a glowing halo. No browser fetch happens merely because the dropdown opened. The control
uses the shared icon vocabulary and carries its accessible label/tooltip. A failed download is shown as a
concrete session action error, while a preview refusal is shown inside the selected resource tab, never mistaken
for file content. The dropdown is transient: clicking outside it dismisses it.

## agent awareness

The always-materialized system contract mentions the capability in one short operational line: after producing
an artifact worth handing back, an agent publishes its path with `spex session files add <path>`. Detailed
usage stays in `spex guide files`; the prompt advertises the capability without becoming a second manual.

The guide teaches the three CLI operations, the fact that the path is live and host-local, and that the
dashboard downloads only on click. It explicitly distinguishes this from [[file-attach]], which sends human
bytes to a worker; files sends an agent-owned path to a human.
