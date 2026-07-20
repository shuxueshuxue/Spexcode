// `run` is bound in SessionInterface (it needs the live closures); here we hold the complete static identity.
// `button:false` = no toolbar twin. `typed:false` = toolbar-only (relaunch is not an inbox command).
// Availability, colour, icon, label, typed twin, and execution all flow through this one registry.
export const UI_COMMANDS = [
  { name: 'type',  color: 'yellow', icon: 'keyboard', button: true, pressed: true, suggest: true,
    when: (st, lv) => !!st && st !== 'offline' && st !== 'queued' && lv !== 'offline',
    labelKey: 'session.typeBtn', titleKey: 'session.typeTitle', descKey: 'session.cmd.typeDesc' },
  // eval's surface is the session-scoped Evals page, not a console-local tab or lifecycle button — the typed
  // `/eval` navigates through the same permanent door rendered in the toolbar (`button: false`, available for
  // every session state; an offline input is disabled, but the registry still states the honest capability).
  { name: 'eval', color: 'cyan',   button: false, when: (st) => !!st,
    labelKey: 'sessionEval.btn', titleKey: 'sessionEval.btnTitle', descKey: 'session.cmd.evalDesc' },
  { name: 'merge', color: 'green', icon: 'git-merge', button: true,
    when: (st, lv) => (st === 'review' || st === 'done') && lv !== 'offline',
    labelKey: 'session.merge', titleKey: 'session.cmd.mergeTitle', descKey: 'session.cmd.mergeDesc' },
  { name: 'relaunch', color: 'blue', icon: 'rotate-ccw', button: true, typed: false,
    when: (st, lv) => !!st && st !== 'queued' && lv === 'offline',
    labelKey: 'session.relaunch', titleKey: 'session.relaunchTitle' },
  { name: 'stop',  color: 'muted',  button: false, when: (st, lv) => !!st && st !== 'offline' && st !== 'queued' && lv !== 'offline',
    titleKey: 'session.cmd.stopTitle', descKey: 'session.cmd.stopDesc' },
  { name: 'close', color: 'red',    button: false, when: (st) => !!st && st !== 'offline',
    titleKey: 'session.cmd.closeTitle', descKey: 'session.cmd.closeDesc' },
]

// bind the static registry to the live per-render actions, then keep only the commands available in the
// current session state. `runners` maps name → the closure that DOES the thing (the same closure the toolbar
// tool and typed command call), so the surfaces cannot drift apart.
export function uiCommandsFor(status, runners, liveness = 'online') {
  return UI_COMMANDS
    .filter((c) => c.when(status, liveness))
    .map((c) => ({ ...c, run: runners[c.name] }))
}
