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
process.env.ELECTRON_RUN_AS_NODE = '1'

const entry = process.env.SPEXCODE_DESKTOP_ENTRY
if (!entry) {
  console.error('spec-desktop: SPEXCODE_DESKTOP_ENTRY is unset — the shell must name the spex CLI entry.')
  process.exit(1)
}
await import(entry)
