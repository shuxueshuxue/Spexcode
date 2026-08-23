---
scenarios:
  - name: governed-file-opens-in-place
    tags: [frontend-e2e]
    description: >-
      Drive a real browser to a spec document, confirm no source reader is mounted there, click its `code:`
      chip, and read the independent `#/file/<path>` document. Inspect the editor's `contenteditable`, the
      gutter's line count, the progress state, and the first line; screenshot both settled states. File with
      `spex eval add source-view --scenario governed-file-opens-in-place --image <png> --pass`.
    expected: >-
      The spec document is prose-only with no `.specview-code` and no automatic `SourceView`. Clicking a
      `code:` entry focuses its independent file tab at `#/file/<path>`; the editor reports
      `contenteditable="false"`, the gutter numbers real lines, and progress reflects the file's true size.
      Several entries naming one file still resolve to that one file address.
  - name: viewer-follows-the-board-theme
    tags: [frontend-e2e]
    description: >-
      With a file open, sample the editor background and one keyword token's computed colour, then switch
      `data-theme` to a light theme and sample both again. Sample a node status dot in the same pass, for
      contrast. Screenshot each state.
    expected: >-
      Both the editor background and the token colours change with the theme, because every colour resolves
      from the board's own CSS custom properties rather than from hexes pinned in the component. The node
      status dot does NOT change in the same measurement — it pins one theme's values inline — and that
      contrast is the point of the scenario: it is the mistake this viewer exists to not repeat.
  - name: selection-dispatches-as-composer-attachment
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/source-selection.e2e.mjs
    description: >-
      Through a real browser, open a governed file, drag-select several lines in the CodeMirror reader, and
      activate its selection affordance. Read the New Session composer: the attachment chip must carry the
      governed path and inclusive line range. Edit the surrounding prompt, remove the chip, verify no token or
      path remains in the visible draft, and press Enter; inspect the backend's ordinary created session and
      file the settled screenshots as `m4-*` evidence with `spex eval add source-view --scenario
      selection-dispatches-as-composer-attachment --image <png> --pass`.
    expected: >-
      Selection is an explicit parent callback from the read-only viewer, never an automatic launch or a
      SourceView dispatch path. New Session shows a removable structured attachment while the prompt remains
      a normal editable textarea; removing it removes its encoded context from the prompt, and the final
      edited text reaches the existing `POST /api/sessions` path without a second route or session field.
---
# eval.md - source-view

The second scenario deliberately measures a neighbour it does not own. A claim like "this re-themes" reads as
satisfied by any screenshot of a dark UI; putting a known non-following element in the same sample turns it
into a comparison that can fail. The status dots are not this node's to fix — they are the control.
