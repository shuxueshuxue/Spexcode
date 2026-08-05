---
concern: session create binds [[id]] to a node the graph does not have, while --base five lines away refuses an unknown value with a 400
by: 53f55aa4-83cc-4bb9-95a8-c75666b33d51
status: open
nodes: sessions-core, id, 节点id
created: 2026-08-05T17:16:23.380Z
---

Spec: sessions-core

**`[[id]]` implicit node binding never checks the graph; `--base`, in the same handler, refuses
loudly.** Same command, two standards:

- `sessions.ts:2143` takes the first `[[id]]` mention in the prompt and binds the session to it
  **without ever consulting the graph**.
- `sessions.ts:2150-2155` rejects a `--base` that names no commit with a **400**, before creating
  anything.

Measured this run: session `bd42c738`'s record carries `node: 节点id` on branch
`node/节点id-bd42`, while `spex graph --json` holds 242 nodes and **no `节点id`**.

## Where the value came from is the interesting part

It came from a **teaching sentence in the dispatch brief** — 「用 `[[节点id]]` 引用即可」, prose
*about* the syntax, using a placeholder as its example. The binder cannot tell an example from a
reference, so **prose explaining a mechanism became data fed to that mechanism.** Anything that
documents `[[id]]` inside a prompt is a live binding.

Related surface evidence: a session displaying as literally `节点id` has been seen in a spec-eval
tooltip on the board, so a bogus binding is not confined to the record — it reaches the product UI.

## Why the asymmetry is the defect rather than the missing check

Both values are user-supplied identifiers resolved at create time against a source of truth the
backend already holds; one is validated and one is not, five lines apart. Whatever the right policy is
(refuse like `--base`, or accept-and-report an unknown id as unbound), the two should not disagree
**within one handler**. Note the cost asymmetry too: a bad `--base` costs one 400, while a bad
`[[id]]` costs a worktree, a branch name and a session record that all carry the wrong id for the rest
of the lane's life — the *unchecked* one is the expensive one.

Distinct from the known `spex session new --name` parser defect: that mis-parses a flag, this
mis-binds a validated-elsewhere identifier.
