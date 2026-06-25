// @@@ board commands - the `/` commands the session ❯ inbox handles ITSELF (close, merge, nav mode, proof)
// instead of dispatching the line to the agent. This registry is the SINGLE source of truth: a typed
// `/<name>` and the matching header button are ONE action with ONE identity, never two codepaths and never
// two hues. Each entry's `run` is bound in SessionInterface (it needs the live closures — act, setNavMode,
// setProofOpen); here we hold only the static identity (name + colour + i18n keys + when-available).
//
// `color` is the load-bearing field: it is the command's identity, painting BOTH where it appears — the
// header button and the coloured `/` menu row — the SAME hue, so the command and its button read as the
// same thing. The hue follows each button's own accent: proof = cyan, nav = yellow (the keyboard-cursor
// hue), merge = green (the "merged ×N" badge), exit = red (the destructive close). `button:false` means the
// command has no header twin (exit's close lives on the row's right-click menu) — it exists only as a typed
// command. `when(status)` gates a command to the session states where it applies, exactly as the buttons
// were gated before (nav whenever live; proof/merge only at review/done).
export const BOARD_COMMANDS = [
  { name: 'nav',   color: 'yellow', button: true,  when: (st) => !!st && st !== 'offline',
    labelKey: 'session.navBtn', titleKey: 'session.navTitle', descKey: 'session.cmd.navDesc' },
  { name: 'proof', color: 'cyan',   button: true,  when: (st) => st === 'review' || st === 'done',
    labelKey: 'proof.btn', titleKey: 'proof.btnTitle', descKey: 'session.cmd.proofDesc' },
  { name: 'merge', color: 'green',  button: true,  when: (st) => st === 'review' || st === 'done',
    labelKey: 'session.merge', titleKey: 'session.cmd.mergeTitle', descKey: 'session.cmd.mergeDesc' },
  { name: 'exit',  color: 'red',    button: false, when: (st) => !!st && st !== 'offline',
    titleKey: 'session.cmd.exitTitle', descKey: 'session.cmd.exitDesc' },
]

// bind the static registry to the live per-render actions, then keep only the commands available in the
// current session state. `runners` maps name → the closure that DOES the thing (the same closure the header
// button's onClick calls), so button and command can never drift apart.
export function boardCommandsFor(status, runners) {
  return BOARD_COMMANDS
    .filter((c) => c.when(status))
    .map((c) => ({ ...c, run: runners[c.name] }))
}
