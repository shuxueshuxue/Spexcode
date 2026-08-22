// The utilityProcess entry. It exists for ONE reason, and the reason is not obvious enough to inline.
//
// The backend re-spawns itself through `process.execPath`, which under Electron is the Electron binary, so
// it needs ELECTRON_RUN_AS_NODE to come back up as Node. But that variable cannot be handed to the utility
// process in its own env: Electron launches it as
//   electron --type=utility --utility-sub-type=node.mojom.NodeService …
// and with the flag set the binary reads those Chromium switches as Node options and exits —
//   /proc/self/exe: bad option: --type=utility
// so the shell never gets a backend at all. `execArgv` is not a way around it either: Electron puts the
// values in `process.execArgv` and never executes them.
//
// Setting it HERE — inside the child, once it is already running — is the placement that works: it reaches
// only the processes this one spawns, which is exactly the set that needs it.
import { spawn } from 'node:child_process'

process.env.ELECTRON_RUN_AS_NODE = '1'

// The utilityProcess is not a process-tree boundary: the CLI supervisor can reparent its reload child to init.
// On Linux the scoped copy is the boundary. Its watchdog is deliberately inside the scope so a dead utility
// can be turned into a cgroup stop even after the backend has been reparented.
if (process.platform === 'linux' && process.env.SPEXCODE_DESKTOP_SCOPE_CHILD !== '1') {
  const parentPid = String(process.pid)
  const unit = `spex-desktop-${process.pid}-${Date.now()}`
  const env = {
    ...process.env,
    SPEXCODE_DESKTOP_SCOPE_CHILD: '1',
    SPEXCODE_DESKTOP_SCOPE_PARENT: parentPid,
    SPEXCODE_DESKTOP_SCOPE_UNIT: unit,
  }
  const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? ''}`
  env.XDG_RUNTIME_DIR = runtime
  env.DBUS_SESSION_BUS_ADDRESS = process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=${runtime}/bus`
  const watcher = `(while kill -0 "$SPEXCODE_DESKTOP_SCOPE_PARENT" 2>/dev/null; do sleep 0.1; done; cgroup=$(awk -F: '$1 == "0" { print $3 }' /proc/self/cgroup); printf 1 > "/sys/fs/cgroup\${cgroup}/cgroup.kill") & exec "$@"`
  const child = spawn('systemd-run', [
    '--user', '--scope', '--collect', '--quiet',
    '--property=KillMode=control-group', `--unit=${unit}`, '--',
    '/bin/sh', '-c', watcher, 'sh', process.execPath, process.argv[1], ...process.argv.slice(2),
  ], { env, stdio: 'inherit' })
  child.once('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
  child.once('error', (error) => { console.error(`spec-desktop: failed to enter Linux cgroup: ${error.message}`); process.exit(1) })
  await new Promise(() => {})
}

const entry = process.env.SPEXCODE_DESKTOP_ENTRY
if (!entry) {
  console.error('spec-desktop: SPEXCODE_DESKTOP_ENTRY is unset — the shell must name the spex CLI entry.')
  process.exit(1)
}
await import(entry)
