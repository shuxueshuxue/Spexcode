---
title: tooltip
status: active
hue: 210
desc: The app's one themed tooltip — a singleton data-tip bubble (hover + keyboard focus, delayed, edge-flipping) replacing native title= on the dashboard's controls.
code:
  - spec-dashboard/src/Tooltip.jsx#TooltipLayer
---
# tooltip

## raw source

The dashboard's hover hints were all native `title=` — the browser's default yellow box: ugly, unstyled,
blind to the app's light/dark theme, uncontrollable in timing and placement. A modern app draws its own
tooltip. Replace the visual layer with one shared component; keep the accessibility layer (`aria-label`)
untouched.

## expanded spec

One singleton `TooltipLayer` (mounted once in the desktop shell) is the whole system. There is no
per-callsite component: any element carrying a `data-tip="…"` attribute participates, so migrating a
control is swapping `title=` for `data-tip=` — no restructuring, no wrapper. The layer delegates at the
document level (`pointerover`/`pointerout` rather than mouse events, so even disabled buttons tip) and
portals one bubble to `<body>`.

Behaviour, the modern contract:

- **Hover and keyboard focus both trigger.** Hover arms a ~400ms intent delay (with a short warm window,
  so sweeping across a row of controls swaps tips quickly); keyboard `:focus-visible` shows immediately —
  a mouse click's focus stays quiet. Esc, scroll, resize, or any press dismisses.
- **Above by default, flips when clipped.** The bubble centres over the anchor with a small arrow; when
  the viewport would clip it above, it flips below, and it clamps horizontally with the arrow still
  pointing at the anchor. Fade/slide transition in and out.
- **Theme-adaptive is a hard requirement.** The bubble styles only through the palette CSS variables
  (`--panel2 --ink2 --line`) under [[dashboard-shell]]'s `:root` / `:root[data-theme=<code>]` scheme, so
  every theme preset renders a native-feeling bubble and a theme flip restyles it with zero component
  logic. No hardcoded colours.
- **Accessibility keeps both channels.** Existing `aria-label`s stay (the visual tooltip only replaces
  the *visual* `title=`); while shown, the layer stamps `aria-describedby` on the anchor pointing at the
  `role=tooltip` bubble. Multi-line tips (`\n` joins) render as lines, not one blob.

The migrated surfaces are the interactive chrome: the [[side-nav]] rail, the
HUD/help and action buttons, session pills/avatars/status glyphs, chips and badges across the node,
evals, and issues views. The phone face keeps native `title=` (no hover there, and the layer mounts only
in the desktop shell).
