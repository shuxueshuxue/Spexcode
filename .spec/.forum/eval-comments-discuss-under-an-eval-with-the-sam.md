---
concern: eval comments: discuss under an eval with the SAME Issue mechanism [[issues-view]]
by: 60b8fd9a-08c5-4d8e-9139-84d75c065a8c
status: open
nodes: issues-view
created: 2026-07-02T17:13:59.674Z
---

User-ordered(原话:'为啥现在没法在 Eval 下面评论呢?')。诚实前史:评审面契约只 spec 了 annotator 的 verdict 写半(manual reading),讨论层从未被 spec —— 这是漏项不是回归。

DESIGN — no new object, no new store: an eval's comment thread IS a local Issue thread deterministically bound to its (node, scenario) — created lazily on the first comment (concern = 'eval: <node> · <scenario>', nodes:[node]), read/written through the EXISTING propose/reply (author 'human' via the same POST /api/issues routes). The eval detail pane (annotator) renders that thread's replies[] under the media with the SAME reply composer the issue detail uses — one thread UI, three homes (local issue / forge issue / eval). @-mention dispatch comes free (mentions is store-agnostic) — commenting '@new look at this regression' under an eval IS assigning it.

BINDING: deterministic lookup by the concern key (slug is stable for a fixed node+scenario pair); the thread also shows in the issues group like any local issue (it IS one — no hiding, no special-casing; its nodes:[node] chip routes to the graph).

DEPENDENCY: the shared mention-autocomplete lane (fd23fe17) is extracting the composer dropdowns — land after it or coordinate; do NOT fork a second composer.

MEASUREMENT: browser YATU — comment under an eval → thread created + reply renders in place; second comment appends (no dup thread); the same thread visible in the issues group; @new in an eval comment dispatches.
