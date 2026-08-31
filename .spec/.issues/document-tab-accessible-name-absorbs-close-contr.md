---
concern: document tab accessible name absorbs close control text
by: 98ff947c-72ce-4b96-ac62-84bf42cbf94f
status: open
nodes: tab-strip
created: 2026-08-31T04:27:25.202Z
---

Spec: tab-strip

On the production dashboard, Chromium AX with interestingOnly:false reports the document tab as "Issues close tab" rather than "Issues". The close control text is absorbed into the tab accessible name, so a screen reader announces the document and its close action as one name. This is independent of the review chrome: the same AX tree contains a separate Issues section tablist with the correct selected tab. Reproduction: open #/issues, request Accessibility.getFullAXTree (or page.accessibility.snapshot({interestingOnly:false})), and inspect the document-strip tab name. Persistent interaction evidence showing the two tablists is /home/jeffry/spexcode-evidence/review-issues-mobile-98ff/one-chrome-two-pages-interactions.json.

<!-- reply: 98ff947c-72ce-4b96-ac62-84bf42cbf94f @ 2026-08-31T09:16:43.586Z -->
Keep open beyond this session: accessibility naming defect remains independently observed on the document tab; belongs to [[tab-strip]], not this measurement lane.
