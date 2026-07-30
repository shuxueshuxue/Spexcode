// `run` is bound in SessionInterface (it needs the live closures); here we hold the complete static identity.
// `button:false` = no toolbar twin. `typed:false` = toolbar-only (relaunch is not an inbox command).
// Availability, colour, icon, label, typed twin, and execution all flow through this one registry.
export function mergeAvailability(session = {}) {
  if (session.archived) return { enabled: false, disabledTitleKey: 'session.cmd.mergeUnavailableArchived' }
  if (session.proposal !== 'merge') {
    if (session.proposal === 'nothing') return { enabled: false, disabledTitleKey: 'session.cmd.mergeUnavailableNothing' }
    if (session.proposal === 'close') return { enabled: false, disabledTitleKey: 'session.cmd.mergeUnavailableClose' }
    return { enabled: false, disabledTitleKey: 'session.cmd.mergeUnavailableNoProposal' }
  }
  if (session.lifecycle !== 'awaiting' || session.status !== 'review') {
    return { enabled: false, disabledTitleKey: 'session.cmd.mergeUnavailableLifecycle' }
  }
  if (session.liveness !== 'online') return { enabled: false, disabledTitleKey: 'session.cmd.mergeUnavailableLiveness' }
  return { enabled: true }
}

export const UI_COMMANDS = [
  // The resident Command Box opener pins to the toolbar's right edge. It is toolbar-only: direct xterm
  // input is the default, so there is no typed `/type` command or takeover mode.
  { name: 'command', color: 'blue', icon: 'command', button: true, typed: false, pressed: true, anchor: 'right',
    when: (session) => !!session?.status && session.status !== 'offline' && session.status !== 'queued' && session.liveness !== 'offline',
    labelKey: 'session.commandBtn', titleKey: 'session.commandTitle' },
  // eval's surface is the session-scoped Evals page, not a console-local tab or lifecycle button — the typed
  // `/eval` navigates through the same permanent door rendered in the toolbar (`button: false`, available for
  // every session state; an offline input is disabled, but the registry still states the honest capability).
  { name: 'eval', color: 'cyan',   button: false, when: (session) => !!session?.status,
    labelKey: 'sessionEval.btn', titleKey: 'sessionEval.btnTitle', descKey: 'session.cmd.evalDesc' },
  { name: 'merge', color: 'green', icon: 'git-merge', button: true,
    when: (session) => !!session?.status, availability: mergeAvailability,
    labelKey: 'session.merge', titleKey: 'session.cmd.mergeTitle', descKey: 'session.cmd.mergeDesc' },
  { name: 'relaunch', color: 'blue', icon: 'rotate-ccw', button: true, typed: false,
    when: (session) => !!session?.status && session.status !== 'queued' && session.liveness === 'offline',
    labelKey: 'session.relaunch', titleKey: 'session.relaunchTitle' },
  { name: 'stop',  color: 'muted',  button: false, when: (session) => !!session?.status && session.status !== 'offline' && session.status !== 'queued' && session.liveness !== 'offline',
    titleKey: 'session.cmd.stopTitle', descKey: 'session.cmd.stopDesc' },
  // cold archive ([[archive]]) is typed-only: it exact-stops before filing. Archived rows expose no command-box
  // lifecycle verbs; their card/context-menu resume action is the sole restore path.
  { name: 'archive',   color: 'muted', button: false, when: (session) => archiveEligible(session?.status, session?.archived),
    titleKey: 'session.cmd.archiveTitle', descKey: 'session.cmd.archiveDesc' },
  { name: 'close', color: 'red',    button: false, when: (session) => !!session?.status && session.status !== 'offline',
    titleKey: 'session.cmd.closeTitle', descKey: 'session.cmd.closeDesc' },
]
export const archiveEligible = (status, archived = false) => !!status && !archived && !['queued', 'retired', 'corrupt'].includes(status)

// bind the static registry to the live per-render actions, then keep only the commands available in the
// current session state. `runners` maps name → the closure that DOES the thing (the same closure the toolbar
// tool and typed command call), so the surfaces cannot drift apart.
export function uiCommandsFor(session, runners = {}) {
  // Archive suppresses every lifecycle action and Command Box, but the disabled merge witness keeps the
  // selected session's toolbar geometry and proposal affordance honest.
  const commands = session?.archived ? UI_COMMANDS.filter((command) => command.name === 'merge') : UI_COMMANDS
  return commands
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
