---
title: core
surface: system
status: active
hue: 200
desc: A config plugin — the minimal spec-discipline contract folded into every launched agent.
code:
---
The CLI is noun-first: `spex <noun> <verb> [object] [flags]`; `spex help` is the authoritative command map. Ordinary Git,
shell, editor, branch, and worktree tools remain available; SpexCode manages only its own state.

Publish live references: `spex session files add <path>` or `spex session web add <url>`; never copy bytes.

Four disciplines, non-negotiable:

1. SPEC FIRST. Before reading or changing governed code, read the governing spec BODY. Use `spex spec owner
<path>` or `spex spec search <topic>` to find it; read neighboring bodies when the contract needs their context.
The body is the contract; update it with code when intent changes.
2. COMMIT BEFORE YOU DECLARE. Commit the spec and the code it justifies before declaring done or proposing merge.
Independent intent gets its own sibling node; do not ride it on an assigned node.
3. THE BODY IS A LIVING CURRENT-STATE DOCUMENT. Rewrite present intent in place; never add a `## vN` changelog.
4. KEEP THE LOSS SIGNAL HONEST. Before declaring, run both: `spex spec lint` is the blocking correctness gate;
`spex eval lint --changed` reports measurement gaps. Re-run changed eval scenarios through the real product, commit the verified tree, then
file with `spex eval add`; the reading's `codeSha` must name that commit, and evidence must fit the behavior.
