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
global-store `files.json` beside its `session.json`; its JSON array of absolute paths is the complete,
durable state. Posting, listing, and removing edit only that list. They never copy, move, stage, or upload
the target, so a listed path remains a live reference and may point anywhere the session host can reach.

## one list, three operations

The agent-facing porcelain is `spex session files add <path>`, `spex session files ls`, and
`spex session files retract <path>`. `add` resolves a relative input against the caller's current
directory and stores the resulting absolute path exactly once; `ls` reads the list; `retract` removes that
exact resolved path. The spelling follows the shared CLI vocabulary: `add` appends a record, `ls` reads a
collection, and `retract` withdraws the author's published record. All three operate on the calling agent's
session, so an agent needs only its artifact path to publish it.

The reference is intentionally host-local. An absolute path preserves the location the posting agent meant
even when a later CLI command has another cwd; a copied session record on another machine cannot make that
path portable, and therefore reports a missing file rather than silently resolving a different local path.

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

Clicking a posted path opens a pop-out preview; its neighbouring download tool retains the direct download.
Preview renders only text extensions as escaped plain text and raster PNG, JPEG, GIF, or WebP images. Text is
served as `text/plain` and rendered as text by the dashboard; images arrive as a response blob in an image
element. SVG, HTML, PDF, archives, binaries, and unknown extensions have no preview and answer a named
`415` directing the human to download them. That restricted set costs convenient PDF/SVG viewing, but keeps
untrusted content out of the dashboard document rather than gambling on a safe renderer.

Preview refuses a file larger than **2 MiB** with a named `413` that states the ceiling and actual size; it
never truncates. The cap keeps a published multi-gigabyte artifact from becoming a browser allocation. The
human may still download any posted file regardless of its previewability or size.

## dashboard handoff

The selected session's top-right file icon is disabled grey when its projected list is empty. Once at least
one path is posted, the same icon is live and opens a compact, content-sized dropdown. Each row shows only
the file name; the full absolute path is exposed only on its copy-path icon's tooltip, preserving the useful
host-local detail without turning a toolbar menu into a path dump. Long names clip at a viewport-safe bound,
but a short name does not inherit a fixed empty menu width. The name is inert: its eye icon is the preview button,
its adjacent download icon starts the download, and its copy icon writes the absolute path. Preview opens in a centred overlay pop-out, separate from
the dropdown's original position. No browser fetch happens merely because the dropdown opened. The control
uses the shared icon vocabulary and carries its accessible label/tooltip. A failed download is shown as a
concrete session action error, while a preview refusal is shown inside its pop-out, never mistaken for file
content. Both surfaces are transient: clicking outside the open dropdown dismisses it, and clicking the
preview backdrop dismisses the pop-out.

## agent awareness

The always-materialized system contract mentions the capability in one short operational line: after producing
an artifact worth handing back, an agent publishes its path with `spex session files add <path>`. Detailed
usage stays in `spex guide files`; the prompt advertises the capability without becoming a second manual.

The guide teaches the three CLI operations, the fact that the path is live and host-local, and that the
dashboard downloads only on click. It explicitly distinguishes this from [[file-attach]], which sends human
bytes to a worker; files sends an agent-owned path to a human.
