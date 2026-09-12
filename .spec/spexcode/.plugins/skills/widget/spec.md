---
title: widget
surface: skill
status: active
hue: 165
desc: Draw a small HTML component into the conversation with `spex session widget put <name> <file>` and point at it as `[[widget:<name>]]`, instead of describing it in prose. Use when asking the human to choose between options, when reporting progress they will read again later, when comparing several things side by side, or when supervising a fleet of sessions — and use it to redraw the picture once their answer arrives.
---

# widget

Some answers are a paragraph and some are a picture. A question with three options, a run that is 3 of 7
nodes in, a table of children and what each is waiting on: written as prose these are read once and then
re-derived every time someone comes back to them. Drawn as a widget they stay legible, and the question
becomes a thing the human can answer in one click instead of retyping.

This is one command, not a workflow: write an HTML file, put it under a name, mention the name.

## when to reach for one

- **A choice.** You are about to declare `ask` with options in the note. Draw them; their click fills the
  input box with the answer and they press send once.
- **Progress with a shape.** Counts, stages, what is blocked. Not a running commentary — redraw when the
  meaning changes, and keep the prose about what it MEANS.
- **A comparison.** Two designs, three candidate seams, a before and after of a measurement.
- **Supervision.** A view of the sessions you dispatched, their states, what each is waiting on. Read those
  facts from the API rather than baking a list that is wrong a minute later.

Prose stays prose. An explanation, a decision's reasoning, a report of what you did: those are sentences, and
a widget around them only adds a frame.

## the five rules that are easy to get wrong

1. **Write the page's content, not a document.** Markup, your own `<style>`, your own `<script>`. The
   dashboard supplies the doctype, the head, the theme and the bridge.
2. **Use the host's tokens** so it looks like it belongs: `var(--fg)`, `var(--accent)`, `var(--line)`,
   `var(--muted)`, `var(--ui-font-sans)`. Leave the background transparent; the frame sizes itself.
3. **Your buttons cannot send.** `spex.draft(text, state)` fills a block above the human's input box; they
   press send. So a click is always safe, and six ticks arrive as one message.
4. **Draw yourself from `spex.state`**, which is what their last send committed. That is what makes a reload
   show what was chosen. What was never sent is kept nowhere.
5. **Redraw after their answer.** When the message arrives, put a new version under the same name: the
   question becomes what is being done about it. Same name is the update.

## the shortest complete example

```html
<button data-v="A">Plan A</button><button data-v="B">Plan B</button>
<style>button[aria-pressed="true"]{border-color:var(--accent);color:var(--accent)}</style>
<script>
  const ui = window.spex || { state: null, draft() {} }
  let current = ui.state?.choice || null
  const paint = () => document.querySelectorAll('button')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === current)))
  document.querySelectorAll('button').forEach((b) => { b.onclick = () => {
    current = b.dataset.v
    ui.draft('I choose ' + current, { choice: current })
    paint()
  } })
  paint()
</script>
```

Then `spex session widget put plan plan.html`, and write `[[widget:plan]]` in the note that asks. Or attach it
to the declaration itself: `spex session ask --note "…[[widget:plan]]…" --widget plan=plan.html`.

`spex guide widget` is the full contract: every verb, what survives a reload, what a widget may read for
itself, and why the text and the state are both said rather than derived from each other.
