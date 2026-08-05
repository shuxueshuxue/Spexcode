---
concern: The graph ships below its own legibility floor at the default viewport
by: 53f55aa4-83cc-4bb9-95a8-c75666b33d51
status: open
created: 2026-08-05T20:37:27.546Z
---

# The graph ships below its own legibility floor at the default viewport

Derived from source, **not a filed reading** — the rendered number has to come from
`getBoundingClientRect` in a real browser, and I have not run one. What follows is a prediction plus a
criterion that can refute it.

## The spec already claims the thing that appears to fail

`node-graph/spec.md` asserts legibility twice, in its own words:

- `:6` (desc) — "the root layer stays a short **readable** column"
- `:23` — "the **root layer is always a short, readable column** no matter how deep or bushy the real tree is"

So this is not a new requirement. It is the first *measurable* form of a claim the node has been making all
along.

## What the code does

| Fact | Source |
|---|---|
| authored title size | `styles.css:378` `.node-title` → `--type-control` → **12px** (`:28`) |
| shipped default zoom | `Dashboard.jsx:630` `defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}` |
| zoom floor | `Dashboard.jsx:631` `minZoom={0.4}` |
| zoom ceiling | `Dashboard.jsx:632` `maxZoom={1.6}` |
| fit-to-viewport | **does not exist** — `fitView` has 0 occurrences in `spec-dashboard/src` |
| camera zoom behaviour | `centerOn` reuses the current zoom when none is passed; `animateView` interpolates zoom only toward an explicit target |

Therefore:

```
zoom 0.85 (shipped default) -> 12px renders at 10.2px   below the authored floor
zoom 0.40 (minZoom)         -> 12px renders at  4.8px
zoom 1.00                   -> 12px renders at 12.0px   at the floor
```

**The failure is unconditional.** It carries no premise about tree size, node count, or viewport
dimensions: the default viewport is a hardcoded constant, so a graph with *one* node renders its title at
10.2px. And because the camera preserves zoom, 0.85 is sticky — drilling never restores 1:1, so a session
that never manually zooms in never sees an authored-size title.

## The operating point is already documented in a green reading

`node-graph/evals.ndjson:26` — a **pass** on `structural-updates-are-atomic`, codeSha `8e46c2b0` — records
"the viewport moves through 18 progressive states … at **constant 0.85 zoom**". That reading is not wrong;
it measured geometric atomicity and 0.85 was correctly incidental to it. But it establishes that 0.85 is
the *measured* operating point rather than a default users leave behind, and it means a green reading
already exists on a board whose every title was rendering at 10.2px.

## Criterion

> In the default view, a node title's **rendered** size is ≥ its **authored** size.

Authored via `getComputedStyle(title).fontSize`; rendered via `getBoundingClientRect()`, which composes the
ancestor `scale()` that computed style cannot see. The two quantities come from different layers by
construction, so the ratio cannot self-confirm.

This criterion is also the first one on this thread that is **structurally immune to the empty-population
family**: it tests a constant of the viewport, not a property of a set, so its population requirement is
"at least one node" — a state the product cannot avoid — rather than "at least one *active* node", a state
someone has to arrange and can silently fail to arrange.

## The trade was already made, silently

0.85 buys visible context by spending legibility. That is a legitimate call, but **no spec body records
it**: `0.85` appears nowhere in any `spec.md` or `eval.md` in the tree (only in code and in reading notes).
`spec.md:27` specifies "the camera eases onto the target at **constant zoom**" — an atomicity invariant,
correctly — and never states what that constant is or that it sits below the type floor.

So the resolution is one of exactly two, and both are cheap:

1. **Keep 0.85** — then the body has to say so, say what it buys, and stop claiming "readable" unqualified;
   the type floor for tiles has to rise to whatever survives 0.85 (14px+ authored to clear 12px rendered).
2. **Default to 1.0** — then "readable" stands as written, and whether the tree fits becomes the honest
   open question, answered by collapse (which this node already owns) rather than by scale.

What is not available is the current state: a body asserting readability, a constant quietly contradicting
it, and no record that anyone chose.

Spec: node-graph
