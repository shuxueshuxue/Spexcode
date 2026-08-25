---
title: merge
surface: skill, command
status: active
hue: 130
desc: Land this session's completed branch into the repository's source-of-truth branch as one verified no-ff merge, preserve unrelated dirty work, push it, and settle the session honestly. Use when the user says /merge, asks to merge or land this session, or when a supervisor dispatches a merge.
kind: mutating
---
# merge

Land the current SpexCode session's branch; do not dispatch another merge request back to yourself.

1. Inspect the current session, branch, worktree, source-of-truth checkout, and live Git status. Treat every
   pre-existing dirty or untracked path as user-owned. Record its exact status and diff fingerprint; never
   discard it, fold it into your commit, or hide it behind an unverified stash.
2. Commit this session's intended spec and code first. In this worktree, merge the latest source-of-truth
   head into the session branch. Resolve conflicts here, then rerun the focused proof, build, `spex spec lint`,
   and `spex eval lint --changed` required by the changed behavior.
3. Immediately before landing, verify
   `git merge-base --is-ancestor <source-head> <session-head>`. If it fails, sync again. A clean textual merge
   is not product proof.
4. In the source-of-truth checkout, make one `--no-ff` merge of the already-synced session tip. Do not resolve
   conflicts there. If unrelated dirty work prevents the merge, preserve it byte-for-byte and report the exact
   overlap rather than forcing, resetting, or committing it.
5. Verify the source checkout has no `MERGE_HEAD`, the session tip is its ancestor, unrelated dirty
   fingerprints are unchanged, and the post-merge gates pass. Push the source-of-truth branch only after
   those checks.
6. Stop test-owned processes and publish any evidence a human must inspect. If the work is fully landed and
   no decision remains, run `spex session done --propose close` as the final action. Never close your own
   session directly. If a real decision or external wake-up remains, declare the truthful alternative instead.

`spex session merge <SEL>` is the supervisor-facing dispatcher that sends this workflow to another session.
Inside the target session, execute the workflow above; do not call `spex session merge .` recursively.
