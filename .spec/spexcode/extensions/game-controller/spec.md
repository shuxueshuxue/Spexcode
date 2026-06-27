---
title: game-controller
status: pending
hue: 200
desc: Drive the dashboard (and dictate) with a game controller — our own package, its own repo. PENDING.
---
# game-controller

**Status: pending.** This node is the *intent*; the implementation will be our **own dedicated package in
its own repository** (an [[extensions]] satellite — no in-repo code here, link added once the repo exists).
We deliberately chose to build our own rather than depend on a third-party mapper or a borrowed profile, so
we own the mapping, the voice path, and the upgrade story.

## what it is

A small standalone program that lets a game controller drive the SpexCode dashboard hands-free, and dictate
into it. It is **not** part of SpexCode's front or back end — it runs beside it, on the user's machine.

## the contract it must honour

- **Map at the OS level, emit REAL keystrokes.** The controller→key mapping happens in the OS, not in the
  browser. This is the load-bearing decision: a real keystroke reaches the dashboard in the browser **and**
  can trigger OS-level facilities a page never could — the reason an in-browser Gamepad-API bridge was
  rejected (a synthetic `KeyboardEvent` is untrusted, never leaves the page, and can't reach the Fn key or
  any OS voice hotkey).
- **Speak the dashboard's own keys.** It emits the very keys [[keyboard-nav]] names (its `keymap.js`
  registry). No new vocabulary.
- **Decoupled, no runtime link, no sync.** It does not talk to SpexCode. The dashboard's keymap is itself
  user-editable; if a user rebinds a key there, they re-configure the controller too. We accept the
  double-edit to keep both sides free-standing — syncing would mean a live link between things that should
  stay independent.
- **Voice is first-class.** A reserved control toggles start/stop dictation. The package owns its voice
  path (its own engine or an integrated one) rather than depending on an external IME, so transcription
  works without routing through a system voice shortcut.

## prior art weighed (and why still our own)

Generic OS remappers (AntiMicroX / JoyToKey / Steam Input) cover Linux/Windows but have no clean macOS
story; ClaudeGamepad is macOS-native with built-in voice but GUI-only mapping and no released build. Both
informed the contract above; neither is a dependency. Building our own keeps the mapping a real artifact we
control and lets the voice + dashboard fit be first-class rather than incidental.
