// `run` is bound in SessionInterface (it needs the live closures); here we hold only the static identity.
// `button:false` = no header twin (exit/close live as typed commands + the right-click menu). `when` gates by state.
export const BOARD_COMMANDS = [
  { name: 'type',  color: 'yellow', button: true,  when: (st) => !!st && st !== 'offline',
    labelKey: 'session.typeBtn', titleKey: 'session.typeTitle', descKey: 'session.cmd.typeDesc' },
  // eval's surface is the console's always-on Eval TAB, not a header button — the typed `/eval` just jumps
  // to that tab (`button: false`, available for any live session, not only review).
  { name: 'eval', color: 'cyan',   button: false, when: (st) => !!st && st !== 'offline',
    labelKey: 'sessionEval.btn', titleKey: 'sessionEval.btnTitle', descKey: 'session.cmd.evalDesc' },
  { name: 'merge', color: 'green',  button: true,  when: (st) => st === 'review' || st === 'done',
    labelKey: 'session.merge', titleKey: 'session.cmd.mergeTitle', descKey: 'session.cmd.mergeDesc' },
  { name: 'exit',  color: 'muted',  button: false, when: (st) => !!st && st !== 'offline',
    titleKey: 'session.cmd.exitTitle', descKey: 'session.cmd.exitDesc' },
  { name: 'close', color: 'red',    button: false, when: (st) => !!st && st !== 'offline',
    titleKey: 'session.cmd.closeTitle', descKey: 'session.cmd.closeDesc' },
]

// bind the static registry to the live per-render actions, then keep only the commands available in the
// current session state. `runners` maps name → the closure that DOES the thing (the same closure the header
// button's onClick calls), so button and command can never drift apart.
export function boardCommandsFor(status, runners) {
  return BOARD_COMMANDS
    .filter((c) => c.when(status))
    .map((c) => ({ ...c, run: runners[c.name] }))
}
