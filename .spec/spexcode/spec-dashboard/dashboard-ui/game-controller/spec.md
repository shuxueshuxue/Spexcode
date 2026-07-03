---
title: game-controller
status: pending
hue: 200
desc: Controller mode — a gamepad drives the dashboard through the action registry, and voice is its text input. PENDING.
---
# game-controller

**Status: pending** — this node is the contract; no code exists yet. When it lands, the `code:` list
names the dashboard's pad module and the backend's ASR endpoint.

## what it is

**Controller mode**: sit back with a game controller and run the whole manager loop — walk the board,
open reviews, drive sessions — without touching a keyboard. A pad has no keys, so the mode is two halves
that only together make a complete input surface: the **pad** for navigation and verbs, and **voice** for
every place the dashboard wants text (a session prompt, search, a new-session instruction). Dictation is
not a companion feature; it is the mode's text input method.

## the contract

- **In the browser, on the action registry.** The dashboard reads the pad with the Gamepad API (standard
  mapping — the browser has already normalized the common pads) and resolves buttons and sticks to the
  same stable action ids [[keyboard-nav]]'s registry names. Not synthetic keystrokes: nothing is
  synthesized, so nothing is untrusted — the pad is simply the registry's second dispatcher, beside the
  keyboard handler. One registry means pad and keys cannot drift, and a user's key rebind changes which
  *key* fires an action, never the action the pad is bound to.
- **Zero install, every screen.** Because the mode lives in the page, it works wherever the dashboard is
  open — any machine, a TV or tablet with a Bluetooth pad, the public gateway — nothing installed
  per-device, no OS permissions.
- **Voice: the browser captures, the backend recognizes.** A reserved control is push-to-talk: the page
  records the mic (a secure-context surface) and posts audio to the backend, whose **pluggable ASR
  adapter** turns it to text — a local engine or a cloud key, the operator's choice — landing in whatever
  input has focus. The browser's own recognition (Web Speech) is not the path: it is vendor-bound and
  unreliable where we run. Owning the voice path means owning the adapter, not the recognizer.
- **The backend knows the board.** Recognition is biased with the project's own vocabulary — node ids,
  session names, spec titles — so mixed-language dev speech resolves to the right identifiers. A generic
  recognizer can never do this, and it is the seam a hosted offering can charge for: self-hosters bring
  an ASR key; hosted supplies one, ready out of the box.

## why not an OS-level remapper

An earlier shape of this node was a standalone OS remapper in its own repo (an [[extensions]] satellite)
emitting real keystrokes, because a page could neither fake trusted keys nor reach the OS voice hotkey.
Both reasons fell: dispatching action ids needs no key events at all, and voice stops needing any OS
facility once the backend owns ASR. What survives from that survey: no third-party mapper (AntiMicroX /
JoyToKey / Steam Input / ClaudeGamepad) is a dependency — the mapping stays our artifact, in the
dashboard, beside the registry it reads.
