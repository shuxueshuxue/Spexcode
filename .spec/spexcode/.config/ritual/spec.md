---
title: ritual
status: active
hue: 30
surface: system
desc: SpexCode's opinionated git flow — node/<id> branches, one spec+code commit, a Session: trailer, a --no-ff merge.
code:
---
# ritual

Land each change as a `node/<id>` branch off `main`. Bundle the spec node and the code it justifies into
**one** `spec: <id> — <reason>` commit that carries a `Session: <id>` trailer in its body — that trailer
is the version's attribution. Then merge the branch into `main` with `--no-ff`: `merge node/<id>: <reason>`.
Delete the node branch and retire the worktree afterward.

See `CLAUDE.spexhidden.md` for the full ritual.
