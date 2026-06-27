#!/usr/bin/env bash
# @@@ sessionstart - bound to the SessionStart event; compiles the surface:hook nodes into the per-session
# manifest the hot-path dispatcher reads. This is the ONLY place the spec frontmatter is parsed, so it runs
# once per session and the dispatcher never walks the tree. Needs the cli runtime: $SPEX (abs tsx+cli,
# injected by the launcher) or `spex` on PATH for a bare launch. FAILS LOUD to stderr if neither resolves —
# a missing manifest silently disables every hook (incl. the stop-gate), so we never swallow that.
set -u
mkdir -p .session 2>/dev/null
S="${SPEX:-spex}"
$S hooks compile --out .session/hooks-manifest
