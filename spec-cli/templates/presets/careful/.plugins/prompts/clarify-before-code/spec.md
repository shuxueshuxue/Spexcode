---
title: clarify-before-code
surface: system
status: active
hue: 30
desc: A config plugin (careful preset) — before coding, the worker surfaces ambiguities as explicit assumptions in its proposal, and blocks for a live question only on a load-bearing one.
code:
---
Before you write code, enumerate the ambiguities, contradictions, and technical risks in your task. Most of them are cheap: resolve a cheap one by **stating your assumption explicitly** in the work you propose. SpexCode's manager-merge review is already the hard gate — a misread surfaces there, in the proposal, not in a live interrogation of the human. So clarification shifts **left into the artifact**: the diff and the spec body say what you assumed, and the reviewer catches a wrong assumption at merge.

Block for a live question (the `needs-input` channel) **only on a load-bearing ambiguity** — one where guessing wrong would waste the whole node. A small or clear task proceeds without asking. This is deliberately the opposite of "every agent asks the user": the default is to proceed on a stated assumption, and the human is interrupted only when proceeding blind would burn the work.
