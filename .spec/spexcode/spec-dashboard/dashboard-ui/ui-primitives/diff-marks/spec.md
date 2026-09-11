---
title: diff-marks
status: active
hue: 150
desc: The one vocabulary for showing a change — the +N −N tally, git's one-letter status, the front-giving path label, and the add/remove hue pair every diff surface spends.
code:
  - spec-dashboard/src/DiffMarks.jsx
related:
  - spec-dashboard/src/diffTree.js
  - spec-dashboard/src/diffTree.test.mjs
  - spec-dashboard/src/DiffDocument.jsx
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/i18n/en.js
  - spec-dashboard/src/i18n/zh.js
  - spec-dashboard/test/diff-review-chrome.e2e.mjs
---
# diff-marks

The dashboard shows a change in three places: a session's branch diff ([[diff-document]]), a spec node's
pending redline, and its version history ([[node-popup]], [[spec-view]]). They had grown three dialects of
the same marks. Deletions were red in one and orange in the other two, each surface drew the `+N −N` tally
in its own spans, and the path layout belonged to a component only one surface could use. A change must
read the same wherever it is shown, so the marks live here once.

**The pair.** What a change added and what it removed wear one hue pair, `--diff-add` and `--diff-del`,
derived from each preset's green and red. Each comes in two strengths: a line tint that says which rows
moved, and a stronger word tint that marks the characters that did. The session diff's editor rules, the
history line diff, the redline's inserted and struck words, and every tally spend these tokens. No surface
picks a diff colour of its own, and none keeps a library's light-only defaults.

**The tally.** `DiffStat` prints additions then deletions, always both, in the pair's two hues with
tabular figures: on a file row, a file header, a scope heading, a review total, and a version row.

**The status.** `StatusMark` prints git's own one-letter vocabulary (M, A, D, R, C, T, and U for untracked)
in one fixed cell, so a column of rows lines up. The status word, in the reader's language, is its tooltip
and accessible name. Modified is the common case and stays muted. Additions and untracked files take the add
hue, deletions the remove hue, and renames and copies the accent. A status git adds later still shows its
first letter rather than nothing.

**The path label.** `PathLabel` spends its width on the leaf and dims the directories in front of it. When
room runs out, the directories give first, at their FRONT, behind a real ellipsis, because a path is
identified by its tail. The leaf gives only once they are gone, and then at its own tail. The label's DOM
reads front to back, so a copy, a find, or a screen reader gets the real path. The earlier reversed layout
clipped at the right end but copied as `mobile-ui/app-frame/…/spec.md` and drew its ellipsis over the text.
Callers keep the untruncated path on the tooltip.

The marks own drawing, not meaning. Which files are listed, what their counts are, and what a click does
belong to the surface that mounts them.
