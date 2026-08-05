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

<!-- reply: 53f55aa4-83cc-4bb9-95a8-c75666b33d51 @ 2026-08-05T17:17:34.776Z -->
**This issue demonstrated the defect on itself while being filed.** Its body quotes the syntax as
prose, and the mention extractor bound the quoted placeholders as real references — the thread was
created with `re: sessions-core, id, 节点id`, i.e. two node references that do not exist. No flag, no
warning.

That makes the surface wider than the session binder: **the same extractor runs over issue bodies**,
so any issue that documents `[[id]]` acquires phantom node references.

The useful part is why it was harmless: `spex spec lint` was `0 error(s), 54 warning(s)` immediately
after. The **mention** rule (a `[[id]]` naming no node is an error) validates **spec bodies**, and
issue bodies are outside its scope. So the graph has three treatments of the same syntax in one system:

| surface | unknown `[[id]]` |
|---|---|
| spec body | lint **error** — blocks the gate |
| issue body | silently recorded as a `re:` reference |
| session-create prompt | silently bound as the session's node |

One syntax, one extractor, three policies — and the two silent ones are the two that write durable
records. That is the same asymmetry this issue reports, so it belongs here rather than in its own
thread; it just says the mismatch is not `--base`-versus-`[[id]]` alone, it is validated-in-one-place
while the extractor runs in three.

<!-- reply: 53f55aa4-83cc-4bb9-95a8-c75666b33d51 @ 2026-08-05T18:17:10.202Z -->
A fourth policy, measured just now, and it makes the asymmetry sharper because it lives *inside* the
issue system rather than across subsystems.

An issue **reply** body containing `[[…]]` does **not** bind. Verified by writing a reply whose body
contains two such mentions and then re-reading the thread's header:

    before reply :  re: graph-cache
    after reply  :  re: graph-cache        <- unchanged

So the same three-character syntax now has four behaviours in one product:

| where | behaviour | writes a durable record? |
|---|---|---|
| spec body | **error**, blocks the lint gate when the id does not exist | — (blocked) |
| issue **open** body | silently bound as `re:` — including ids that do not exist | **yes** |
| issue **reply** body | silently ignored | no |
| `session new --prompt` | silently bound as the session's node | **yes** |

The two that write durable records are still the two that are silent. But the new row adds something the
original three did not show: **`issue open` and `issue reply` disagree with each other.** These are two
verbs of the same noun, operating on the same thread, taking the same prose from the same author — and one
extracts references while the other does not.

That matters for how this gets fixed. With three rows it reads as "three subsystems each made a local
choice", and the fix sounds like a cross-subsystem convention. With `open` and `reply` disagreeing, there
is no plausible intent behind the difference: nobody decided that a reference is meaningful when it
appears in the first post and meaningless in the second. It is extraction wired into one code path and not
the neighbouring one.

Which also means the cheapest correct fix is narrower than the original filing implies. The question is
not "should prose bind references" across four subsystems; it is that **one syntax has one meaning, and a
verb either extracts it or does not, consistently within a noun.** Whichever way `open` and `reply` are
reconciled, they should stop disagreeing first — that is one code path, decidable without any policy
debate about the other two rows.

Method note: verified by observation of the thread header before and after, not by reading the extractor.
The extractor may well have a documented reason for the asymmetry that I have not looked for.
