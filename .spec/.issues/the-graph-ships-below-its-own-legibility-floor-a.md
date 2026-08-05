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

<!-- reply: 53f55aa4-83cc-4bb9-95a8-c75666b33d51 @ 2026-08-05T21:01:25.687Z -->
## Amendment 3: where the 12px came from, and exit 1 costs more than stated

Two measurements taken after Amendment 2. The first explains the mechanism without appealing to anyone's
intent; the second makes exit 1 more expensive than this issue priced it.

### The token was calibrated on a different surface

`--type-control` (12px) has **82 consumers** in `styles.css` — buttons, inputs, menu items, table cells,
`code`, `.desc`, pagination, review labels. Exactly **one** of them lives inside the scaled transform pane:
`.node-title`. (Checked by resolving every class `SpecNode.jsx` renders against `styles.css`; `.node-title` is
its only `--type-control` hit.) The other 81 render at 1:1.

So the token is not wrong. On the surface where 81 of its consumers live, 12px *is* 12px, and that was a
defensible choice. The defect is that one consumer carried the constant into a surface with a different
transform, where the default renders it at 10.2px.

The asymmetry is what hid it. At 41/41 someone would have asked which context the value was for; at 81/1 the
token reads as settled and the outlier looks like it is using the house style.

This also says where the repair belongs. Not "give `.node-title` its own constant" — that is one more branch.
**A surface that transforms its children owes its children a floor, expressed where the transform is chosen
rather than where each child is authored.**

### The tile is smaller than this issue said, and it lands `spec.md:25` exactly

I measured only the title. Every *other* text in the tile is `--type-caption` = **10px**, the bottom step of
the whole scale (10/11/12/13/14/16/18):

```
.node-title    --type-control  12px  ->  10.2px  @ 0.85
.node-ago      --type-caption  10px  ->   8.5px
.node-ver      --type-caption  10px  ->   8.5px
.drift-badge   --type-caption  10px  ->   8.5px
.issue-badge   --type-caption  10px  ->   8.5px
```

This makes `spec.md:25` land precisely rather than generally. "Fill-versus-outline survives zoom that digits
do not, so the lit tab is the signal and the counts are detail" is not a design aphorism — **it is a correct
price paid against these specific numbers.** The node knew 8.5px digits were unreadable and gave the counts a
fill fallback.

The title got one step up the scale and no fallback. So the body's state is: it understood the problem, priced
it for the least important text in the tile, and did not price it for the identity carrier.

### Consequence for exit 1

Exit 1 as written ("raise the type floor for tiles to 14px+ authored") was priced against the title alone. It
is four rows wider than that: raising only `.node-title` leaves four caption rows at 8.5px on a tile whose
spec claims a readable column. Combined with the side effect already recorded — larger text → larger tiles →
more zooming out — exit 1 is now clearly the more expensive of the two.

### Not a defect, recorded so nobody re-runs it

The scale also holds `--type-hero: clamp(5.5px, 1.15vw, 9.5px)`, smaller than caption despite the name. Its
sole consumer `.si-hero` (`:1520`) is `mono` + `white-space: pre` — ASCII art, where a glyph is a picture
element — and it is outside the pane. Correct as authored.

Spec: node-graph

<!-- reply: 53f55aa4-83cc-4bb9-95a8-c75666b33d51 @ 2026-08-05T21:12:08.155Z -->
## Amendment 4: the spec promises and demotes the same quantity, and the demoted channel is sub-pixel

This is the strongest form of the finding, and it reorders the issue. The defect is not primarily a font
size. **The defect is that `spec.md:25` names a quantity as the debt the collapsed layout owes its reader,
demotes that same quantity thirty words later, and ships it through the smallest channel on the tile.** The
default zoom is what makes that consequential rather than merely verbal.

### The contradiction, which needs no zoom at all

`spec.md:25`, one paragraph, two sentences:

> "with sessions scattered across the tree, and without expanding anything or moving the camera, the board
> reads **how many places are in motion** and under which branch each one sits."

> "Fill-versus-outline survives zoom that digits do not, so the lit tab is the signal and **the counts are
> detail**."

"How many places are in motion" is simultaneously **the aggregate the layout owes** and **detail**. The
author's voice says the same thing at `styles.css:393-395`:

> "Fill/no-fill is the one signal that still reads when the tile's own digits have blurred away, so it
> carries the 'something is happening in there' meaning; **the dots below only say how many sessions**."

That `only` is an explicit demotion. So the split is deliberate and coherent as engineering — fill answers
*whether*, and it survives; the dots answer *how many*, and they are accepted as fragile. What is not
coherent is that the paragraph opens by promising *how many* is what the board reads.

This is readable at any zoom, by anyone with the two sentences side by side.

### What the default zoom does to the demoted channel

The counts are carried by `.hidden-dots` — one disc per distinct session inside a collapsed branch
(`SpecNode.jsx:85-87`), capped at **3** (`:66`, `inside.slice(0, 3)`) with a `+k` overflow. Inside the
transform pane, same multiplication as the title:

```
.hidden-dots i  width/height  4px  ->  3.40px
.hidden-dots    gap           1px  ->  0.85px     <- sub-pixel
.hidden-dots i  ring (shadow) 1px  ->  0.85px
```

**The load-bearing number is the gap, not the disc.** A 3.4px disc is perfectly visible. What fails is
*separability*, and separability is the precondition for counting. A sub-pixel gap is necessarily
antialiased away, and because each disc carries a **different** hue (`labelColor(e.seed)`), two merged discs
leave no seam — they produce a third colour. The result does not look like two adjacent dots; it looks like
one dot.

So both branches of the count fail, and the second fails by the spec's own concession:

| branch | how it is read | at zoom 0.85 |
|---|---|---|
| ≤ 3 sessions | enumerate the discs | separation is 0.85px, sub-pixel |
| > 3 sessions | read `+k` | it is a **digit** — `:25` concedes digits do not survive zoom |

`+k` inherits `.node-expand`'s `--type-caption` (`styles.css:388`) → **8.5px**. There is no third path.

### Selective payment, now measured rather than inferred

Amendment 3 showed the tile's captions were *priced* for the shrink: the counts were demoted to detail and
fill was given the signal, precisely because 8.5px digits do not read. That pricing is correct.

Put beside this amendment, the shape closes:

- the **least important** text on the tile (ago, version, badges) got the fallback;
- the **identity carrier** (the title) got one step up the scale and no fallback — Amendment 2/3;
- the aggregate the spec **names as the debt** got the smallest channel on the tile and no fallback.

Three consumers of the same shrink, and the one the contract singles out is the one that paid least.

### The recovery paths, pre-empted — and one is excluded by the contract

Both obvious rebuttals are worth answering here rather than after someone raises them.

**"Hover it — the tooltip names each session."** True (`SpecNode.jsx:78-81`). But `:25` states the debt
*with its conditions attached*: the board must read how many places are in motion **"without expanding
anything or moving the camera."** A per-tile pointer interaction is therefore not a weak answer to a
scanning question — **it is excluded by the same sentence that creates the obligation.**

**"Select it — the panel shows the title larger."** It does not. The graph's detail panel renders the title
at `NodeView.jsx:151` → `.part-title` → `--type-control` = **12px** (`styles.css:572`). The `--type-title`
(16px) consumers are ReviewShell's `.ds-title`, a route titlebar `h1`, an offline message, `rich-text h1`,
and the two **mobile** classes — none is the desktop graph's panel. So:

> **12px is the largest size at which this product ever renders a spec node's title on the desktop.** The
> scale holds 13 / 14 / 16 / 18 above it, and the desktop uses none of them for node identity.

Selecting a node restores the title from 10.2px to its authored floor. It never exceeds it. "Click it and
you'll see" has no bigger view to appeal to.

### Consequence for the exits

Exit 2 (default 1.0) repairs all three consumers at once with one constant, and restores the `≤3` branch to
its authored 1px separation.

Exit 1 (raise authored sizes) is now **six** rows wide, not one and not four: the title, four caption rows,
and the dot geometry — and the dot geometry is the awkward one, since raising a 1px gap to survive 0.85
means authoring fractional-pixel separations, which is where this class of bug comes from in the first
place.

### Evidence grade

Unchanged from the opening paragraph: **derived from source, not a filed reading.** Every rendered figure
above is `authored × 0.85`, not a measurement. The browser pass now owes two numbers, and the second has a
numerator the product itself specified:

1. a node title's rendered size ≥ its authored size, in the default view;
2. with **N** sessions active inside a collapsed branch, whether **N** is recoverable from the tab
   (enumeration for N ≤ 3, `+k` for N > 3).

Spec: node-graph

<!-- reply: 53f55aa4-83cc-4bb9-95a8-c75666b33d51 @ 2026-08-05T21:16:23.510Z -->
## Amendment 5: correcting Amendment 4 — the panel renders the title at 18px, and the ratio comes back

**Amendment 4 contains a false claim. Retracting it here.**

### What was wrong

Amendment 4 stated:

> "12px is the largest size at which this product ever renders a spec node's title on the desktop."

That is false. I measured `.part-title` (`--type-control`, 12px, `styles.css:572`) and took it for the panel's
node title. It is not: `.part-title` is the **section label** on a card header, carrying the literal strings
"raw source (human)" and "expanded spec (agent)" (`NodeView.jsx:147`, titles from `:163`/`:166`),
`text-transform: uppercase`.

The node's identity is rendered one component away, at **`NodeView.jsx:201`**:

```jsx
<div className="pane-doc">
  <h1># {node.title}</h1>
```

`.pane-doc h1` → `--type-heading` = **18px** (`styles.css:516`, token at `:32`) — the **top** of the type
scale, not the bottom.

So the sentence in Amendment 4 was refutable by opening one file, which is exactly the failure mode that
amendment was trying to pre-empt on other grounds. Read Amendment 4 with that paragraph struck; nothing else
in it depends on the claim.

Cause worth naming, since it is the reusable part: **a plausible element bearing the right *kind* of content
is the easiest wrong measurement to make.** "The panel's title styling" and "the styling of the panel's title"
are different objects, and I measured the first while asking about the second.

### The correction promotes the ratio instead of retiring it

Amendment 2 demoted the size comparison to a footnote because it was cross-surface — a mobile 16px against a
desktop 12px — where "two faces should differ for good reasons" is a fair rebuttal. That reasoning was sound
for that axis. The real comparison is not on that axis at all:

> **Same desktop, same product, same datum `node.title`: 18px in the detail panel, 10.2px rendered on the map
> tile. A factor of 1.76.**

There is no second face to appeal to, and the direction is the least defensible one available: the product
*states* that this string is worth the top of its type scale, and then renders the same string at 10.2px on
the surface built for scanning — the surface whose spec claims a "readable" column.

**So the ratio returns to the primary evidence, on this axis.** The mobile `--type-title` comparison is
withdrawn entirely; it was the weaker version of a real finding.

### Also narrowing Amendment 4's contract argument

Amendment 4 claimed the tooltip is "excluded by the same sentence that creates the obligation." That reads one
notch past what `:25` says. Its conditions are "without expanding anything or moving the camera" — hovering
does neither. The exclusion is not written.

> Conditions travel with the obligation they qualify — but only the conditions actually written. An obligation
> with named exclusions does not silently acquire another because the other is similar in spirit.

### The argument that needs no exclusion, and no browser

`:25` promises *"how many **places** are in motion"* — places being nodes. The tile's discs are **one per
session** (`SpecNode.jsx:86`), which is a different quantity: one session touching three nodes is one disc and
three places; three sessions touching one node each is three discs and three places.

The promised quantity is not missing from the product. It is **computed** —

```js
const nodes = data.hiddenNodes || 0   // distinct nodes in motion in there, not a sum of the per-session tallies
```

(`SpecNode.jsx:68`, its own comment) — and its **only** consumer is the tooltip string at `:79`
(`specNode.hiddenActive`, rendered as "N nodes being changed by M sessions").

> **The board does not under-render the promised number. The promised number was computed and routed off the
> board.**

That holds at any zoom, needs no browser and no observer, and makes the enumeration branch fail twice over:
even at 1:1 with the discs perfectly countable, counting them answers a different question than the one `:25`
promises the board answers.

So the browser pass owes two measurements and the third item needs none:

1. a node title's rendered size ≥ its authored size, in the default view;
2. with **N** sessions active inside a collapsed branch, whether **N** is recoverable from the tab;
3. *(source only, already settled)* the discs count sessions while `:25` promises places, and `hiddenNodes` —
   the promised quantity — reaches only the tooltip.

Spec: node-graph

<!-- reply: 53f55aa4-83cc-4bb9-95a8-c75666b33d51 @ 2026-08-05T21:29:09.811Z -->
## Amendment 6: retracting Amendment 5's central argument — the spec assigns the channel in the next clause

**Amendment 5's section "The argument that needs no exclusion, and no browser" is false. Retracting it.**

### What was wrong

Amendment 5 argued that the discs count sessions while `:25` promises *places*, and that the promised quantity
(`hiddenNodes`) was computed and routed off the board. Reading `:25` to the end of its own sentence kills both
halves:

> "...the `▸N` tab **fills with the lead hidden author's colour** ... and carries **one dot per distinct session
> working inside**, capped with `+k`; **its tooltip names each session and how many nodes it touches in there**."

1. **The disc rule is the spec's own.** `shown.map` producing one disc per session is compliance, not deviation.
2. **The node-level count is assigned to the tooltip by the spec itself**, in the same clause. `hiddenNodes`
   reaching only the tooltip is the specified behaviour, not a routing failure.

And the promise is discharged by the channel the *following* sentence names: *"the lit tab is the signal and the
counts are detail."* A **place** is a position on the board — which tabs are lit, and where they sit — not a
node. That reading is delivered by fill, which is the property the spec says survives the shrink. My reading
required *place = node* **and** required ignoring the second half of the same sentence.

By the test established one round earlier — *does the original reasoning still hold on its own axis?* — there is
no axis on which "the discs are the load-bearing aggregate" is true. So this is a retraction, not a narrowing.

### The reusable cause, which is worth more than the correction

This is the second time the same reading error produced a false finding. Both have the identical shape:

| promise | channel assignment, in the next sentence |
|---|---|
| activity anywhere must be visible | "it is **not a camera driver**" |
| the board reads how many places are in motion | "**the lit tab is the signal**, and the counts are detail" |

> **A promise says something must exist; the assignment that follows says which channel carries it.** Quoting a
> spec to justify a product change requires reading to the end of the paragraph, because the sentence that
> constrains the implementation is systematically the one *after* the sentence that creates the obligation.

That is an executable rule, not "read more carefully."

### Two consequential demotions

**The "selective payment" shape is withdrawn.** Its second half depended on the retracted claim. Its first half
does not survive on its own either: the tile's version and badges are counts, and *"the counts are detail"* prices
exactly that class. They were priced, not overlooked. No negligence narrative is available, and none is needed.

**The disc-separation finding drops to a polish reading.** With the discs priced as detail by the spec and the
node count assigned to the tooltip, "the separation renders at 0.85px" has **no promise standing behind it**. The
arithmetic in Amendment 6's earlier draft is still true and still unconditional — it is simply no longer evidence
of a contract violation. `devicePixelRatio` still belongs in any reading that touches it, for the reason given
before (without it, two contradictory readings are both correct), but the claim it serves is now product quality,
not a defect.

### What the issue is actually left with — and it is one row wider than "just the title"

The replacement offered was: everything on the tile is consistently, deliberately priced as detail, and the title
is the only element of a different kind — it carries identity, not detail — and the only one with no downgrade
clause. That is the right shape, but the boundary sits one element further out. The tile paragraph promises:

> "a reader sees **at a glance** both *what this node is* and *who/when*."

Three things, not one. And the spec's own row split is the pricing boundary:

- **Row 1 — "identity & recency"**: `status dot · title` plus the recency signal. Both of its text elements are
  named in the at-a-glance promise — *what this node is* and *when*.
- **Row 2 — "marks & people"**: explicitly *"the denser cluster"*. Version and badges live here and are priced.
  (*Who* also lives here, but is carried by avatars — shape and hue, the same shrink-immune channel as fill.)

So the promised, text-rendered elements are **two**:

```
.node-title  --type-control  12px  ->  10.2px      identity; readable-column claim at the spec's opening
.node-ago    --type-caption  10px  ->   8.5px      "when", named in the same at-a-glance sentence
```

(`styles.css:378`, `:379`; both on Row 1, `SpecNode.jsx:118` and `:124`.) `.node-ver` and the drift/issue badges
share the 10px token but sit in the cluster the spec itself calls denser — **drop them from the issue.**

### The remaining case

1. **`.node-title` renders 10.2px against an authored 12px**, on the surface whose spec opens by claiming a
   *"short, readable column"*. Unconditional, arithmetic.
2. **Same desktop, same product, same datum `node.title`: 18px in the detail panel (`NodeView.jsx:201` ->
   `.pane-doc h1` -> `--type-heading`), 10.2px on the map tile. 1.76x.** No second surface to appeal to, and the
   direction is the least defensible one.
3. **`.node-ago` renders 8.5px against an authored 10px**, carrying "when", which the same sentence promises at a
   glance.
4. **`0.85` appears in no `spec.md` and no `eval.md`.** The constant that produces every figure above is
   unrecorded in the governed tree.

Withdrawn from the issue: places-vs-sessions, the tooltip-routing argument, selective payment, the disc geometry,
the dpr grading, `--type-hero`, the mobile `--type-title` comparison.

Owed to a browser, recording `devicePixelRatio`: a Row 1 text element's rendered size >= its authored size, in the
default view. That single measurement covers both surviving rows.

Evidence grade: source verification and arithmetic. No filed reading.

Spec: node-graph
