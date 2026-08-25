export const UI_COMMANDS = [
  // The resident Command Box opener pins to the toolbar's right edge. It is toolbar-only: direct xterm
  // input is the default, so there is no typed `/type` command or takeover mode.
  // `shortcut` names the keymap action that ALSO reaches this command, by id. The tooltip reader resolves
  // it against the live registry, so the printed chord follows a rebind and cannot be a copy that rots.
  { name: 'command', color: 'blue', icon: 'command', button: true, typed: false, pressed: true, anchor: 'right',
    when: (session) => !!session?.status && session.status !== 'offline' && session.status !== 'queued' && session.liveness !== 'offline',
    labelKey: 'session.commandBtn', titleKey: 'session.commandTitle', shortcut: 'shell.commandBox' },
  // eval's surface is the session-scoped Evals page, not a console-local tab or lifecycle button — the typed
  // `/eval` navigates through the same permanent door rendered in the toolbar (`button: false`, available for
  // every session state; an offline input is disabled, but the registry still states the honest capability).
  { name: 'eval', color: 'cyan',   button: false, when: (session) => !!session?.status,
    labelKey: 'sessionEval.btn', titleKey: 'sessionEval.btnTitle', descKey: 'session.cmd.evalDesc' },
  { name: 'relaunch', color: 'blue', icon: 'rotate-ccw', button: true, typed: false,
    when: (session) => !!session?.status && session.status !== 'queued' && session.status !== 'retired' && session.liveness === 'offline',
    labelKey: 'session.relaunch', titleKey: 'session.relaunchTitle' },
  { name: 'stop',  color: 'muted',  button: false, when: (session) => !!session?.status && session.status !== 'offline' && session.status !== 'queued' && session.liveness !== 'offline',
    titleKey: 'session.cmd.stopTitle', descKey: 'session.cmd.stopDesc' },
  { name: 'close', color: 'red',    button: false, when: (session) => !!session?.status && session.status !== 'offline',
    titleKey: 'session.cmd.closeTitle', descKey: 'session.cmd.closeDesc' },
]
// bind the static registry to the live per-render actions, then keep only the commands available in the
// current session state. `runners` maps name → the closure that DOES the thing (the same closure the toolbar
// tool and typed command call), so the surfaces cannot drift apart.
export function uiCommandsFor(session, runners = {}) {
  if (session?.archived) return []
  return UI_COMMANDS
    .filter((c) => c.when(session))
    .map((c) => ({ ...c, ...(c.availability?.(session) || { enabled: true }), run: runners[c.name] }))
}

// Command Box has one ordered command vocabulary. Board actions win because they act in the dashboard;
// SpexCode prompt presets win over same-named harness commands because the backend expands them before the
// harness sees the text. Deduplication here gives every name one row and one meaning.
export function inboxCommands(ui = [], presets = [], harness = []) {
  const seen = new Set()
  return [
    ...ui,
    ...presets.map((preset) => ({ ...preset, source: 'preset' })),
    ...harness,
  ].filter((command) => {
    if (!command?.name || seen.has(command.name)) return false
    seen.add(command.name)
    return true
  })
}
