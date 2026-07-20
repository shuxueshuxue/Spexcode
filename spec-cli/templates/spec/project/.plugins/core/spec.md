---
title: core
surface: system
status: active
hue: 200
desc: A config plugin — the minimal spec-discipline contract folded into every launched agent.
code:
---
The CLI speaks ONE grammar: `spex <noun> <verb> [object] [flags]`. Six nouns — `spec` (the governance graph), `session` (the worktree state machine), `eval` (the measurement system), `issue` (concern threads), `remark` (resolvable pins), `evidence` (content-addressed bytes) — plus a few bare project verbs (`graph` · `init` · `materialize` · `doctor` · `serve` · `uninstall`) whose object is always this project. The verb is always the token right after its noun; a bare noun prints its drawer's help; a `--help` probe is always safe (it prints and exits before the verb runs). `SEL` = session id | unique id-prefix | node id | branch; `.` as a node argument = the node this worktree works on. When unsure of a spelling, ask the tool — `spex help`, `spex help <command>` — never guess from memory: removed spellings only report their replacement and exit.

Four disciplines, non-negotiable:

1. SPEC FIRST. Before you touch code — and merely READING it counts, not only editing — read the governing spec's BODY: its actual prose, not the title, not the one-line desc, not your memory of it. The body is the current contract; code and its comments tell you what the code DOES, only the spec tells you what it is SUPPOSED to do. Don't know which node governs the area? `spex spec search <topic>` — not grep: grep finds code by architectural centrality, search finds intent by user-story. Read the NEIGHBORS' bodies too — the parent that scopes it, the siblings it borders, the children that refine it — a node's intent is only legible against the tree around it. If your task changes the intent, edit the spec first so spec and code land together; if it implements existing intent, make the code honor the spec. The one forbidden move is code that silently diverges from its spec.

2. COMMIT BEFORE YOU DECLARE. Commit your spec node and the code it justifies BEFORE you declare done or propose merge — the commit comes first, never as an afterthought to a declaration. An independently-scoped feature gets its OWN sibling spec node, not a ride-along in your assigned node's commit (cosmetic polish riding along is the smell).

3. THE BODY IS A LIVING CURRENT-STATE DOCUMENT. It states the node's PRESENT intent and is rewritten in place. Never accrete a "## vN" changelog heading, and never add current-state or verdict sections — version history is git's job, not the body's.

4. KEEP THE LOSS SIGNAL HONEST for what you changed — eval readings are the signal the optimizer reads, so a gap is a blind spot. Changed a node that carries a `eval.md`? Re-measure it: run its scenario, compare to the expected, and file the result with `spex eval add <node>`. Match the evidence to the behaviour: a DYNAMIC scenario — anything that moves or is timed (terminal scroll/redraw, an animation or transition, media playback, a multi-step interaction flow) — records a video of the run and files it with `--video`; a STATIC end state screenshots with `--image`; a backend/CLI scenario files its transcript with `--result`. A still of a moving thing proves the wrong thing. File the reading only AFTER the change it measures is committed — a reading's `codeSha` anchors to HEAD at filing time, so verify on the working tree, commit the verified tree, then file; a dirty-tree filing names a commit that lacks your change. Made an obvious frontend change to a node with NO `eval.md`? Give it one — a scenario (description + expected) — so its loss can be measured. `spex eval lint --changed` shows the gaps in exactly the nodes you touched.

Don't reverse-engineer the file formats: `spex guide spec` and `spex guide eval` print the full spec.md and scenario schema on demand. This prompt is the clue; that manual carries the detail.
