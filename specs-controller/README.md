# specs-controller

A **game-controller profile** for the [SpexCode](../) web dashboard — and nothing more. It is *not* a
program, a daemon, or a launcher. It is one mapping file you load into a **generic, OS-level
gamepad→keyboard remapper** you already trust. SpexCode is just one preset; the remapper is generic.

It's a standalone thing (sibling to SpexCode / Codex / Typeless), intentionally decoupled — see the
contract below.

## Why a profile, and why at the OS level

You could imagine the dashboard reading the gamepad itself in the browser. It can — via the Gamepad API —
but it can only turn a button into a **synthetic** `KeyboardEvent`, and a synthetic event is *untrusted*
(`isTrusted === false`): it reaches the page's own JS and **nothing else**. It cannot trigger a browser
default, and it can never reach the OS. So an in-page bridge can drive the board, but it can **never**
trigger an **OS-level voice input** — e.g. WeChat's 2026 PC voice input, whose hotkey (`Ctrl+Win` on
Windows, `Fn` on macOS) is captured by a global OS hook *outside* the page. (And `Fn` isn't even a real
DOM key — keyboards handle it in firmware; a browser can neither read nor synthesize it.)

A **generic gamepad→keyboard remapper runs at the OS level and emits REAL keystrokes.** A real keystroke:

- reaches the focused window normally — so it drives the SpexCode dashboard in the browser, **and**
- is seen by OS-global hotkeys — so a button **can** start/stop WeChat voice input.

That's the whole reason this is a profile for an OS-level tool, not code inside SpexCode.

## The decoupling contract (read this)

There is **no communication** between this profile and SpexCode. None. By design.

SpexCode's keyboard keymap is itself user-editable (Settings → Shortcuts). If you rebind a key there,
**this profile will not know** — you must edit it here too. We deliberately do *not* sync them: syncing
would mean a live link and a protocol between two things that should stay independent, for marginal gain.
The price is that a DIY user edits **two** places. We accept that price; it keeps both sides simple and
free-standing.

Treat `spexcode.profile.json` as the source of truth for the controller, and keep it in step **by hand**
with `spec-dashboard/src/keymap.js` (whose `keys` are the same key names this profile emits).

## Which remapper

Pick any mature generic gamepad→keyboard mapper. This profile uses W3C **Standard Gamepad** button names;
translate them to your tool's names.

| Tool | Platforms | Profile format | Notes |
|---|---|---|---|
| **AntiMicroX** | Linux, Windows | `.amgp` (XML) | Open-source, actively maintained, supports modifier combos (Ctrl+Super…). No macOS. |
| **JoyToKey** | Windows | `.cfg` | Simple, very popular shareware. Easiest on Windows. |
| **Steam Input** | Windows, macOS, Linux | Steam config | The only one covering macOS; use "Desktop Configuration" for non-Steam apps. Combos supported. |

Recommendation: **AntiMicroX** (Linux/Windows) or **Steam Input** (if you need macOS). Enter the mappings
from `spexcode.profile.json` into your tool's UI — the JSON is the canonical list, the tool's own file is
just where it lands.

## The mappings

See `spexcode.profile.json`. Summary (Standard Gamepad → SpexCode key):

```
D-pad / Left stick → arrows   move focus (up/down/parent/child)
X → i                         open node-info popup
Y → /                         search & jump
A → Enter                     cross into session / open board
B → Esc                       close popup / back
RB → o   ·  LB → Shift+o      cycle in-flight edits (· reverse)
RT → +   ·  LT → -   ·  R3 → 0   zoom in / out / reset
Start → Shift+2 (@)           fresh session on the focus node
Right stick ↑/↓ → k / j       scroll the open popup
Back  → [voice toggle]        RESERVED — see below
```

## The reserved voice button

`Back` (change it to any free button) is reserved for **voice input / transcription toggle**. It maps to
a **real OS hotkey**, defaulting to WeChat's hands-free (start/stop) voice shortcut:

- **Windows:** `Ctrl + Win + Shift` (press once to start transcribing, again to stop). Hold-to-talk is
  `Ctrl + Win`.
- **macOS:** `Ctrl + Fn` (continuous). Hold-to-talk is `Fn`. *Caveat:* `Fn` is special — some remappers
  can't emit it; if so, set a custom non-`Fn` hotkey in WeChat 设置-快捷键 and point this button at that.

Using a different voice tool? Just change the button's target to that tool's hotkey. The button is yours.

> WeChat PC voice input is the 2026 feature that works globally in any input box (Word, WPS, browser,
> notepad…); all its hotkeys are customizable in WeChat 设置-快捷键.
