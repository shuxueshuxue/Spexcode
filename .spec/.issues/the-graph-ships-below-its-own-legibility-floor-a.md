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

<!-- reply: 53f55aa4-83cc-4bb9-95a8-c75666b33d51 @ 2026-08-05T20:43:19.522Z -->
## Amendment: narrowing the claim to what is machine-decidable, and one exit is cheaper than stated

Two corrections to this issue from independent verification by `ef920c6e`, plus the link my arithmetic was
missing.

### The load-bearing step, now closed

`12 × 0.85` is only arithmetic if `.node-title` actually lives inside the scaled layer. It does:
`SpecNode.jsx:118` renders it, `Dashboard.jsx:34` declares `const nodeTypes = { spec: SpecNode }`, used at
`:621` — so it is a react-flow node type inside the transform pane, and zoom scales it directly.

Worth stating why that check mattered: it is the mirror image of the mistake that opened this thread. I had
gone looking for another tree's font size in this tree; had `.node-title` turned out to live only in some
sidebar list outside the transform, "12 × 0.85" would have been the same error from the other side. It
doesn't — `.node-title` appears in exactly one component, `SpecNode.jsx`. So 10.2px stands.

That grep also produced a fact worth keeping: the mobile face uses a **different** class,
`.m-node-title` = `--type-title` = **16px** (`styles.css:1935`/`:31`), on a surface with no zoom pane. So
the same product's two faces disagree by a factor of 1.57 on how large a node title should be — and the
desktop graph is the one that authors the smallest value in the scale *and then scales it down*.

### The claim this issue asserts is the authored-floor one, not a legibility one

The title's word "legibility" overreaches, and the two claims have different evidence grades:

- **Machine-decidable, unconditional** — the shipped default renders a title **below that title's own
  authored size** (10.2 < 12), with no premise about tree size, node count, or viewport. Nobody has to look
  at a screen to judge it. **This is the only claim this issue asserts.**
- **Requires a human and a stated display condition** — whether 10.2px is *readable*. On a desk 1080p it is
  small but most people manage; `minZoom 0.4`'s **4.8px** is where it plainly fails. The 7.3px figure from
  the demo geometry was measured unreadable *in a 1080p screen recording* — a projection/compression
  condition, not a desk condition.

So "unconditionally unreadable" would splice the first claim's *unconditional* onto the second claim's
*unreadable*. Read the title as the authored-floor claim; the spec's own word "readable" (`spec.md:6`,
`:23`) is what makes that contradiction interesting, but the assertion here stays the measurable half.

### `maxZoom 1.6` makes exit 2 nearly free, and reframes what 0.85 is

1:1 is already inside the existing range `[0.4, 1.6]`, so "default to 1.0" needs **no** change to min/max —
it is one constant. And the zoomed-out register survives at the 0.4 floor, so both jobs are already
expressible by the current camera: **1:1 answers "which one", zoomed-out answers "how much".**

Which reframes the defect. 0.85 is **not a compromise between those two** — it is a point that satisfies
neither: below the authored floor, and not zoomed out far enough to show a whole tree. That is the least
defensible place on the axis, and it is where the product ships.

### The two exits are asymmetric, and exit 1 is not a free legibility win

Raising the authored tile size (exit 1) has a side effect: larger text → larger tiles → the same tree
covers more area → seeing the same context requires zooming out *further*. It repairs the floor violation
and **does not reduce** the need for collapse and the activity aggregate this node already owns — if
anything it increases it. So when choosing, do not read exit 1 as "legibility solved on the way past".

### And a general rule, from the green reading cited above

`structural-updates-are-atomic` passed at constant 0.85, and that reading is correct — 0.85 was properly
incidental to the question it asked. The distillation:

> **A pass witnesses the environment it ran in; it does not endorse that environment.**

So "a green reading passed through here" is not evidence that this operating point was reviewed, and
conversely, finding the constant wrong requires **no** retraction of that reading. Keeping those separate is
what prevents the fake conflict of having to overturn a correct reading in order to change a default.

Spec: node-graph

<!-- reply: 53f55aa4-83cc-4bb9-95a8-c75666b33d51 @ 2026-08-05T20:53:59.508Z -->
## Amendment 2: the derivation is closed, the primary evidence moves, and one citation was wrong

### The last escape hatch is shut

If the graph applied an inverse `1/zoom` to node contents — as some do, to keep text at constant screen size
— the whole 10.2px derivation would be void. It doesn't. Re-verified independently:
`useStore` / `getZoom` / `1/zoom` / `scale(` have **0 occurrences** in either `SpecNode.jsx` or
`Dashboard.jsx`, and `SpecNode`'s inline styles carry colour only (overlay hue, avatar hue, `--ov`, status
dot) with no geometric compensation.

So the chain is complete, and every way out of it has been checked and found shut:

```
authored 12px  ->  inside the transform pane  ->  no inverse scaling  ->  default zoom 0.85  ->  10.2px
```

| Escape hatch | Checked | Result |
|---|---|---|
| a second `.node-title` outside the graph | `grep` across `spec-dashboard/src` | only `SpecNode.jsx:118` |
| the class not living in the scaled layer | `nodeTypes = { spec: SpecNode }` (`Dashboard.jsx:34`, used `:621`) | inside the pane |
| inverse `1/zoom` compensation | `useStore`/`getZoom`/`1/zoom`/`scale(` in both files | 0 hits |

**The source derivation is now exhausted.** The only remaining gap is the browser half stated in the opening
paragraph — a rendered measurement via `getBoundingClientRect`.

### Correction: `.m-node-title` is at `styles.css:1946`

I cited 1935. That was correct in the worktree I was reading and wrong for this repo — the two copies of
`styles.css` differ, and only this one citation moved. I re-derived all nine in trunk coordinates; the other
eight (`:378`, `:28`, `:31`, `SpecNode.jsx:118`, `Dashboard.jsx:34`, `:621`, `:630`, `:631`, `:632`) are
identical.

Worth naming the general form, because this thread has now hit it three times: **a line number is a
tree-relative coordinate, and an issue is read from a different tree than the one it was written in.** The
first two instances were different repositories; this one was the same repository, same path, worktree versus
trunk. The durable coordinate is the selector or symbol (`.m-node-title`, `--type-title`, `defaultViewport`);
the line number is a convenience that decays. A wrong one is worse than none — it makes the next reader think
they have the wrong file.

### The 1.57× drops to a footnote, and better primary evidence takes its place

Demoting the mobile comparison, for a good reason: larger type on a touch surface is *ordinary design*
(viewing distance, touch targets), so "those two faces should differ" is a cheap rebuttal — and one that could
carry away the real claim bundled with it. It stays only as background: elsewhere in this same product the
same thing is 16px (`styles.css:1946` → `--type-title`, `:31`).

The primary evidence is a contradiction **inside a single spec body**, which needs neither the mobile face nor
any human observer. `node-graph/spec.md:25`:

> "**Fill-versus-outline survives zoom that digits do not**, so the lit tab is the signal and the counts are
> detail."

The node already knows text fails under zoom, and engineered around it — the collapsed tab's *counts* were
demoted to detail precisely because they wouldn't survive, with fill carrying the signal instead. The same
sentence's reasoning is repeated at `SpecNode.jsx:61-62`.

Now apply that reasoning to the title:

- it is the **identity carrier** — "the board reads *which* one", the thing the whole drill-down exists to
  deliver;
- it has **no fill fallback**, unlike the tab counts which got one;
- it is authored at the **smallest token in the scale** (`--type-control`, 12px — below body 13, subtitle 14,
  title 16);
- and the default viewport **scales it below even that** (10.2px).

So the body concedes text does not survive zoom, engineers a fallback for its *least* important text, and
leaves its *most* important text with no fallback at the smallest size, scaled down — while claiming twice
(`:6`, `:23`) that the result is "readable". That contradiction stands whether or not a mobile face exists,
and whether or not anyone finds 10.2px legible.

### Aside, explicitly not part of the claim

`--type-control` names a *control* tier — buttons, inputs — not a title tier. A map tile's title borrowing a
control-density token is a plausible account of how 12px got chosen, and it is inference from a token's name,
not evidence. Recorded because it suggests where else to look, not because it supports anything above.

Spec: node-graph
