---
title: core
surface: system
status: active
hue: 200
desc: A config plugin — the minimal spec-discipline contract folded into every launched agent.
code:
---
Before you touch code — and merely READING it counts, not only editing — READ THE GOVERNING SPEC'S BODY first: open the `spec.md` and read its actual PROSE, not the title, not the one-line desc, not your memory of it. The body is the current contract. Don't already know which node governs what you're about to touch? FIND IT WITH `spex search <topic>` — not grep: grep finds code by architectural centrality, search finds intent by user-story, so grepping first under-discovers exactly the user-facing behaviour the spec foregrounds (for a find-by-story question a keyword can't reach, dispatch the `spec-scout` agent). A node rarely stands alone, so READ ITS NEIGHBORS' BODIES TOO — the parent that scopes it, the siblings it shares a boundary with, the children that refine it — a node's intent is only fully legible against the tree around it. Code and its comments tell you what the code DOES; only the spec tells you what it is SUPPOSED to do — reaching for code before the spec is the exact habit this rule exists to break. Then act deliberately: if your task changes the intent, edit the spec first so spec and code land together; if it implements existing intent, make the code honor the spec. The one forbidden move is code that silently diverges from its spec.

Commit your spec node and the code it justifies BEFORE you declare done or propose merge — the commit comes first, never as an afterthought to a declaration.

A spec body is a living current-state document: it states the node's PRESENT intent and is rewritten in place. Never accrete a "## vN" changelog heading, and never add current-state or verdict sections — version history is git's job, not the body's.

An independently-scoped feature gets its OWN spec node: if you build something separately scoped while working, create a sibling node for it rather than bundling it into your assigned node's commit (cosmetic polish riding along is the smell).

Keep the loss signal honest for what you changed — yatsu is the signal the optimizer reads, so a gap is a blind spot. Changed a node that carries a `yatsu.md`? Re-measure it: run its scenario, compare to the expected, and file the result with `spex yatsu eval <node>`. Made an obvious frontend change to a node with NO `yatsu.md`? Give it one — a scenario (description + expected) — so its loss can be measured. `spex yatsu scan --changed` shows the gaps in exactly the nodes you touched.

Don't reverse-engineer the file formats: `spex guide spec` and `spex guide yatsu` print the full spec.md and yatsu.md schema on demand. This prompt is the clue; that manual carries the detail. The CLI explains itself the same way: `spex help` is the command map (grouped by the loop each verb serves), `spex help <command>` one command's usage — when unsure of a verb, ask the tool, don't guess.
