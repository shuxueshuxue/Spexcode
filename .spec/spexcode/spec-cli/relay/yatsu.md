---
scenarios:
  - name: relay-surfaces-governing-code
    description: >-
      Through the real CLI (YATU), run `spex relay "<topic whose governing node is a leaf with code>" --json`
      against a tree that has the spec-search floor present. Use the canonical case that motivated the whole
      initiative: "how does exit close a session worktree and tmux". File with
      `spex yatsu eval relay --scenario relay-surfaces-governing-code --result <txt> --pass`.
    expected: >-
      The top hit is the governing node (session-console) and its `code` array is NON-empty, leading with the
      file that actually implements the behaviour (SessionInterface.jsx — where the /exit→close interception
      lives). The shape is `{id,title,path,score,code[]}` — the floor's shape with snippet replaced by the
      governed code: paths. So topic→spec→code closes in one call: the agent gets the files to read, not just
      the node. Second case — codeless-parent fall-through: a query whose top hit is a pure-prose PARENT
      (e.g. "what grounds a launched session in its spec" → injected-context) returns its SUBTREE's code:
      union (spec-first.sh + spec-of-file.sh), not an empty list — while a leaf-with-code still returns only
      its own files (descendants are the fallback, never additive).
---
# yatsu.md — relay

The loss watched is **does the relay actually hand back the code an agent needs?** The floor finds the
governing node; the relay's job is to turn that node into its governed files so the agent can go read them.
This scenario measures the canonical jump end to end — the `/exit` topic that began this whole thread — and
checks the relay lands on the leaf node WITH its `code:` files (not an empty list). Measured against the live
`spex relay` and the live floor, never a stub. The codeless-prose-parent case is the known boundary, asserted
as expected behaviour so a future "aggregate children" enhancement re-measures honestly.
