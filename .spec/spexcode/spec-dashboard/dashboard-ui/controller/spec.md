---
title: controller
status: active
session: sess-175f
hue: 200
desc: Drive the board with a game controller, through the keyboard it already has.
code:
  - spec-dashboard/src/gamepad.js
related:
  - spec-dashboard/src/main.jsx
  - spec-dashboard/src/keymap.js
---
# controller

A game controller drives the dashboard **through the keyboard it already has** — it adds an input
device, not a second control plane. The whole feature is one decoupled leaf, `gamepad.js`, mounted once
as an import side-effect from `main.jsx`. The board does not know it exists; delete the file and the
dashboard is byte-for-byte unchanged. The contract between them is the existing key vocabulary, owned by
[[keyboard-nav]].

## the bridge is one-way: button → synthetic key

The leaf reads the **[[keyboard-nav]] registry** (`keymap.js`) for each action's `pad` button, and when
that button goes down it dispatches the action's bound **key** as a synthetic `KeyboardEvent` on `window`
— exactly the event the capture-phase handler already routes. So the controller speaks the registry's
vocabulary and nothing more: it never touches React state, never knows which modal is open (the existing
handler's own guards arbitrate that), and a rebind in [[settings]] moves the controller with the keyboard
because both read the one table. Mapping lives in the registry, not here — this file is the *mechanism*,
the table is the *map*.

## why it must poll, and why that stays contained

The Web Gamepad API has **no button events** — only `gamepadconnected` / `gamepaddisconnected`. Button and
stick state is a per-frame snapshot (`navigator.getGamepads()`), so the only way to see a press is to diff
adjacent frames. That polling is **irreducible but contained**: it runs in a `requestAnimationFrame` loop
**inside this leaf**, and it dispatches only on an **edge** (a button that was up is now down), so everything
downstream still sees discrete events and never knows a poll happened. The loop is **gated on connection** —
started on `gamepadconnected`, stopped on `gamepaddisconnected` — so with no controller plugged in, not a
single frame is polled. A held button **auto-repeats** on the keyboard's own rhythm (a delay, then a steady
rate) so D-pad/stick navigation feels like holding a key; an analog stick crosses a **deadzone** into a
direction and repeats the same way.

## the deliberate edges

- **No text entry.** The controller drives navigation and verbs, never prose. The session terminal
  (xterm) listens on its own textarea, not `window`, so synthetic key events never reach it — and that is
  correct: you do not type a commit message with a thumbstick. The bridge naturally stops at the boundary
  where typing begins.
- **Defaults only, here.** Which button means which action is the registry's default `pad` value, and a
  user can rebind it from the [[settings]] editor; this file holds no map of its own to drift.
- **One device.** The first connected gamepad drives; this is a single-user instrument like the keyboard,
  not a multiplayer surface.
