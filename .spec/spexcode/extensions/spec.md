---
title: extensions
hue: 280
desc: Satellite features that live in their own repos — intent here, code over there.
---
# extensions

Not every feature belongs in the core tree. Some are **peripheral** — useful, but off to the side of what
SpexCode *is* (the spec-driven board, the CLI, the forge, the yatsu loss loop). Sitting such a feature
among the core top-level packages would overstate it. **`extensions` is the home for those**: a grouping
category whose children are **satellites**.

A satellite is **intent here, code elsewhere**. Its spec node lives in this tree and states the contract,
but it owns **no in-repo code** — the implementation lives in its **own repository**, linked from the
node's body. So the heavy machinery this repo's spec system runs on in-repo code — coverage, drift, the
yatsu loss loop — applies to the satellite **in its own repo**, not here; here the node is the **pointer
and the intent**, nothing more.

This keeps two things clean at once: the **core peer list** stays small and genuinely core, and an edge
feature still gets a real, linkable spec home instead of being homeless or smuggled into a core node. New
peripheral features accrete **here**, as children — never as a new top-level peer.
