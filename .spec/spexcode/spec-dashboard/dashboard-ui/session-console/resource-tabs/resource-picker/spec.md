---
title: resource-picker
status: active
hue: 280
desc: A floating button in the session document's top-right corner opens a drawer listing everything the session has published — filterable by a closed set of types, searchable by name, with the human's own uploads marked.
code:
  - spec-dashboard/src/ResourcePicker.jsx
related:
  - spec-dashboard/src/resourceCatalog.js
  - spec-dashboard/src/resourceCatalog.test.mjs
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/TabStrip.jsx
  - spec-dashboard/src/icons.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/i18n/en.js
  - spec-dashboard/src/i18n/zh.js
  - spec-dashboard/src/sessionToolbar.test.mjs
  - spec-dashboard/test/session-files.e2e.mjs
---

# resource-picker

## raw source

The door to a session's posted files and web services is a floating button over the top-right of the session
document — not a tab-row action and not a panel beside the workspace. Pressing it pulls a drawer down out of it.
The drawer is larger and richer than a menu: a search field, type filters, and the human's own uploads marked in
the list. The type filters are drawn only from a preset list of common types, and only for the types the list
actually holds; a file whose suffix is on no preset list is still listed, under All, so an odd suffix can never
make the filters odd.

## expanded spec

**Where it sits.** The button floats in the session document's top-right corner, over whichever face is showing —
Terminal, Conversation, diff, or a resource — and belongs to that document alone: the New Session tab has none,
and the shell's [[document-actions]] slot no longer carries it. It shows how many resources are published, and it
stays live with nothing posted, opening onto an empty state that says where files come from. A pending lifecycle
outcome floats beside it rather than under it. The document reserves that corner for it: a face that draws its
own controls along its top edge — the diff face's toolbar — ends short of the reserve, so the button never covers
a control, while plain content beneath it (terminal text, a posted page) is simply overlaid.

**The drawer.** The drawer hangs from the button's right edge, and its opening is a drawer being pulled: the
panel slides down out of a straight slot line just below the button, cut there while it travels. The cut is made
by a still box around the drawer, never by the moving drawer clipping itself: a moving clip and a moving panel
are updated by different threads, and while the page is busy — a pick opening its tab — they drift apart and the
drawer paints above the slot. The opening has its own duration token because it travels the panel's height,
which a 6px rise does not.

**Closing is not that motion reversed — the drawer fades where it stands.** Retracting through the slot drags
the panel's own bottom shadow up the page as a dark line, and that sweep is what a reader ends up seeing of the
whole gesture. Only the opening is a drawer, therefore: the close spends the short rise duration on opacity
alone and moves the panel's geometry not at all. The opening transition stays live through it, so a close that
interrupts an opening settles into place while it fades rather than jumping. Reduced motion drops both to an
instant. The drawer is `--raised` paper on the
one `--shadow`, sized to its content up to a viewport-bounded height, with the list scrolling inside.

**What it lists.** Every file and web service the session has published ([[files]], [[web]]) — including those
whose tab is already open, which say so; picking any entry is the one open-or-focus operation [[resource-tabs]]
owns, so it opens that resource's tab or focuses the one already open and never duplicates it. Files come newest
first, then web services. A row carries a type mark in the type's tone, the resource's name, and a quiet line
with its type; a folder name appears only when two posted files share a name, because the full host path is the
copy tool's to reveal, not the list's. A file row also offers download and copy-path, the same action paths the
selected file's tab uses.

**The human's uploads.** A file the human sent the session through a composer ([[file-attach]]) is posted to the
session's list when the prompt arrives ([[files]]). The picker lists it under the name the human gave it — not
the upload sink's collision-proof name — with an `uploaded` tag and the time it was sent, and the resource tab it
opens wears the same name.

**Filters.** A single-choice chip row: All, then one chip per preset type the list holds, in the preset's fixed
order so a chip never moves because a count changed, then Uploaded when the list holds any upload. The preset —
HTML, PDF, Markdown, Image, Text, JSON, CSV, Video, Archive, and Web for a published service — is the whole
vocabulary: a suffix outside it mints no chip and reads as a plain File. With nothing to split, the row is not
drawn. Search narrows the filtered list by name.

**Keys and focus.** Opening starts from the whole list and puts focus in the search field; arrows move one
highlight that the pointer also moves, Enter opens the highlighted entry, and Escape closes the drawer through
the shared [[esc-layers]] stack. A close that finds focus inside hands it back through [[focus-return]]. A press
anywhere outside dismisses the drawer, and so does the page losing focus — the only signal a press inside a web
resource's frame sends up. The drawer marks itself a focus overlay, so the console's keyboard router leaves its
keys alone.
