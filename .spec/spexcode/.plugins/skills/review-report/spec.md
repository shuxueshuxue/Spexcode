---
title: review-report
surface: skill
status: active
hue: 165
desc: Hand review evidence to a human as ONE self-contained HTML report, posted with `spex session files add` and pointed at as `[[file:<name>]]`. Use before declaring work ready for review (`spex session done --propose merge`), whenever there are screenshots, before/after pairs, measurements or test output to show, or when asked for a report — instead of posting loose files one by one.
---

# review-report

A reviewer reads one page, not a folder. Twenty loose screenshots make them rebuild the story from file names;
one report tells it with the evidence beside each claim. So when work is ready for review, write ONE
self-contained HTML file, post it, and point at it from the declaration.

## What goes in

- What changed and why, in a few sentences. Name the spec nodes involved as plain `[[node-id]]` text.
- What to look at, in the order a reviewer would check it.
- Evidence next to the claim it supports: before/after screenshots side by side (the before taken from the old
  build fully rendered, the after from this branch once the UI has settled), measured numbers, the exact commands
  that were run and what they returned.
- What was not verified, and why. A gap stated is worth more than a gap hidden.

## How to build it

- One `.html` file that works when opened on its own: CSS inline, images embedded as `data:` URIs, no external
  scripts, fonts, stylesheets or requests.
- Stay under the 16 MiB preview limit (`spex guide files`). Screenshots are the weight: crop them to the part that
  matters instead of shipping full pages.
- Set the page's own background and text colours so it reads the same in a light or dark dashboard.
- The layout is yours — side-by-side comparisons, collapsible raw output, a table of checks with their results —
  whatever makes the review fast. The dashboard shows the file as a live page in a tab beside the session.
- Keep it in the persistent evidence directory outside the product repository, next to the raw artifacts it was
  built from.

## Hand it over

1. `spex session files add <report.html>` — it prints the reference to use, e.g. `[[file:report.html]]`.
2. Put that reference in the declaration note, where the reviewer reads it; in the dashboard it opens the report.
3. Post a raw artifact on its own only when the reviewer needs the file itself (a log to search, a JSON to diff).
   Never post screenshots one by one.
4. Run `spex session files ls` before declaring, and repair or retract anything it marks `INVALID`.
