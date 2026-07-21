---
title: distill
surface: skill, command
status: active
hue: 210
desc: Use when the user wants to inherit a finished, dead, or abandoned session — "distill session X / 继承那个 session 的经验 / 接手它的工作 / harvest or salvage a session". Given a SpexCode session id, harness thread id, or transcript path, read it without resuming, extract decisions, traps, and next actions, salvage unmerged work, retire only resources proven safe to remove, then rename the inheriting session to mark the handoff.
---

# distill

Inherit a finished session's **mind and desk** without waking it: mind is its transcript; desk is its
worktree and branch. **Never resume, reopen, send to, or otherwise re-prompt the old session.** Read files
and git state only until its work has landed.

## Resolve and digest

Accept a SpexCode session id, a Claude/Codex thread id, or a transcript `.jsonl` path.

- For a SpexCode id, find `~/.spexcode/projects/*/sessions/<id>/session.json` (a unique prefix is enough).
  Keep its prompt, `worktree_path`, `branch`, `harness`, and `harness_session_id`; Claude uses the session
  id as its transcript id, while Codex uses `harness_session_id`.
- Otherwise pass the harness id or transcript path directly. The digest header supplies its `cwd` and branch
  when recorded; those locate the desk even when it belongs to another repository.

From the repository root run the plugin's co-located digest:

`node .spec/*/.plugins/skills/distill/digest.mjs <id-or-path>`

It searches the harness's normal local transcript stores and prints human prompts, agent text, concise tool
calls, errors, metadata, edited files, and the raw path. A miss fails loudly; never recover by waking the old
session. For output above about 100 KB, have a subagent return only the distillation below.

## Distill forward

Do not paste the transcript or retell changes git already records. Preserve what git does not:

- goal, actual stopping point, and whether anything landed;
- decisions and rejected alternatives, with reasons;
- failures, dead ends, and user corrections;
- unfinished work and next actions;
- edited files, relevant spec nodes, and the raw transcript path.

## Salvage, then retire

Use the record or digest to inspect the old repository's worktree, branch, merge base, commits, dirty files,
and untracked files. Cross-check the digest's edited-file list because some work may live outside that
worktree. Distinguish an already-merged branch from a branch equal to its merge base, which never committed.

Carry unmerged commits onto the current branch with `git cherry-pick <base>..<branch>`; if replay is
unsuitable, apply the branch diff. Apply dirty changes and copy needed untracked files, then commit them
with the source session named. Keep authorship and `Session:` trailers where possible.

Only after verifying the salvage is present (or the branch truly merged), retire a SpexCode session with
`spex session close <id>`, or remove a bare worktree and then its branch. If proof is incomplete, keep the
resources and report why.

## Rename yourself

Last step: mark the inheritance on the board. If you run as a SpexCode session (inside a session
worktree), `spex session rename . "<name>"` — `.` selects this worktree's own session. Name what this
session now carries — the inherited goal going forward (e.g. `distill: <old goal>`), not the old
session's id. Outside a SpexCode session there is nothing to rename; skip this step.
