---
title: distill
surface: skill, command
status: active
hue: 210
desc: Use when the human wants to inherit a past or dead session's knowledge and work — "distill session X / 继承那个 session 的经验 / 接手它的工作 / 把之前 session 的东西捞回来 / harvest, salvage a finished session". Given a session id, read its transcript from disk (NEVER resume or re-prompt it — its cache is cold and a re-prime is expensive), distill goal · decisions · traps · next steps into the current session, and if its worktree/branch never merged, carry the work over and retire the resources.
---

# distill

Inherit a finished (or dead) session's **mind and desk** without waking it — mind = its transcript on disk,
desk = its worktree/branch. The one iron rule: **never resume, reopen, send to, or otherwise re-prompt the
old session** (cold cache: any turn pays a full re-prime). Everything below is read-only files and plain git.

## 1 · resolve the session

Input: a session id — SpexCode's, a bare harness id (claude / codex thread), or a transcript `.jsonl` path.

- **SpexCode session** (first choice — the join is first-class): its record is
  `~/.spexcode/projects/*/sessions/<id>/session.json` — glob for the id, prefix ok. Take `worktree_path`,
  `branch`, `harness`, `harness_session_id`, `status`, `title`; the originating goal is
  `spex session show <id>` (the record's prompt). For a claude-harness session the transcript id IS the SpexCode session id;
  for codex it is `harness_session_id`.
- **Any other session**: treat the arg as the harness's own id. The transcript carries `cwd` (and, unless
  the worktree was detached, a branch) — the digest header surfaces them; that is your join to its desk.

## 2 · digest the transcript — mechanical first, model second

`node .spec/<root>/.plugins/distill/digest.mjs <id-or-path>` locates the transcript (claude:
`$CLAUDE_CONFIG_DIR` and every `~/.claude*` config dir → `projects/*/<id>.jsonl`; codex: `$CODEX_HOME` or
`~/.codex` → `sessions/**/rollout-*<id>.jsonl`) and prints a compact digest: the human's prompts in full,
the agent's own text, tool calls as one-liners, error results, and a footer with the files it edited and
the raw transcript path. It exits loud when nothing is found — do not fall back to resuming the session.

Read the digest yourself when small; big (>~100 KB) → a subagent returns only the distillation below, so
the inheritance never floods your own context. Its ⚠ error lines and footer are step 3's trap material.

## 3 · distill — forward-looking, not narrative

Completed work is git's job to remember; do not re-narrate it — and never paste raw transcript. State in
your reply, and work from, what the transcript knows that git does not:

- **Goal & landing** — what it set out to do, and where it actually stopped (merged? proposal pending?
  abandoned mid-flight?).
- **Decisions & why** — the direction that was settled, including options weighed and rejected.
- **Traps** — failures, dead ends, gotchas, and every correction the human made. These are the
  highest-value lines in the whole transcript.
- **Unfinished / next actions** — what it would have done next.
- **Pointers** — files edited, spec nodes touched, and the raw transcript path itself, so later questions
  drill into the source instead of inheriting everything up front.

## 4 · salvage the desk

The SpexCode record names the worktree/branch; otherwise the digest's `cwd` may be a linked worktree
(`git -C <cwd> rev-parse --git-common-dir`). Salvage inside that repo — it need not be the one you sit in.
Cross-check the digest's files-edited footer against that worktree: a manager-style session's edits often
live OUTSIDE it (main-checkout config, other repos) — those need a by-hand look, not the recipe below.

- **Already merged** (`git merge-base --is-ancestor <branch> <trunk>`) → nothing to salvage; note it and
  go to cleanup. A tip that EQUALS the merge-base carried no commits — say "never committed", not "merged".
- **Unmerged commits** → carry them onto your current branch: `git cherry-pick <base>..<branch>` (keeps
  authorship and `Session:` trailers); fall back to applying `git diff <base> <branch>` when the history
  is too messy to replay.
- **Uncommitted changes** in the old worktree → `git -C <wt> status --porcelain`; apply its diff to your
  tree and copy untracked files over. Commit the salvage in your own tree, naming the origin session in
  the message.

## 5 · clean up — only after the salvage LANDED

Cleanup discards state — verify the salvaged commits are in your tree (or the branch genuinely merged) first.

- SpexCode session: `spex session close <id>` retires the session and its worktree in one verb.
- Bare worktree: `git worktree remove <wt>`, + `git branch -D <branch>` once confirmed carried or merged.
- In doubt, keep the resources and say so — a kept worktree costs disk; a wrong cleanup costs the work.
