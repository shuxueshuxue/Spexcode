// The utilityProcess entry is a shim so ELECTRON_RUN_AS_NODE reaches only the CLI processes this child spawns.
// Setting it on the utility process itself makes Electron parse Chromium's --type switches as Node options.
process.env.ELECTRON_RUN_AS_NODE = '1'

const entry = process.env.SPEXCODE_DESKTOP_ENTRY
if (!entry) {
  console.error('spec-desktop: SPEXCODE_DESKTOP_ENTRY is unset - the shell must name the spex CLI entry.')
  process.exit(1)
}
await import(entry)
