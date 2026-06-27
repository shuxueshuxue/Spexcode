---
scenarios:
  - name: button-drives-board-through-keyboard
    description: >
      Through the running dashboard in a real browser, simulate a connected game controller (override
      navigator.getGamepads to return a standard-layout pad and dispatch a `gamepadconnected` event), then
      press the action bound to "open node-info" — the X / west face button (button index 2). Confirm the
      node-info overlay opens, exactly as pressing the keyboard `i` would. Also open the settings popup
      (`,`) with the pad connected and read the controller-status line. Watch the console for errors.
    expected: |
      The X button opens the node-info overlay — the controller reached the board through the SAME
      capture-phase keydown handler the keyboard uses (the leaf dispatched the action's bound key as a
      synthetic KeyboardEvent), with no second control plane and no React state touched directly. The
      settings status line reads "controller connected". With no pad connected the status reads "no
      controller" and not a single animation frame is polled (the loop is gated on the connect event).
      Rebinding the action's button in Settings moves the controller with it, because both read the one
      keymap registry. No console errors.
    code: spec-dashboard/src/gamepad.js
    related: [spec-dashboard/src/keymap.js, spec-dashboard/src/bindings.js, spec-dashboard/src/main.jsx]
---

# controller — measurement

YATU through the real browser: drive the dashboard with a simulated standard gamepad, never by calling
into `gamepad.js` directly. The loss this node owns is the **one-way bridge** ([[keyboard-nav]] owns the
keys; this leaf only translates a button into one of them): a pad button must reach the board through the
existing keydown handler — proven by the overlay opening on X exactly as on `i` — so the controller can
never drift from the keyboard or grow a parallel control path. Measuring the *connection gating* (no poll
without a pad) and *rebind-follows-registry* guards the two ways the bridge could quietly over-reach.
File a screenshot of the X-button-opened overlay with `spex yatsu eval controller --scenario
button-drives-board-through-keyboard --image <png> --pass`.
