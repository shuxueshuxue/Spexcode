'use strict'

const { spawn } = require('node:child_process')

const [, , probe, distro, port, bundle = ''] = process.argv
if (!probe || !distro || !port) {
  console.error('spec-desktop: wsl gateway arguments are incomplete')
  process.exit(64)
}
const command = `if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" && nvm use 22 >/dev/null; fi; spex dashboard --port ${Number(port)}`
const { PORT, SPEXCODE_API_URL, SPEXCODE_INSTANCE_ID, SPEXCODE_PROJECT_ROOT, ...cleanEnv } = process.env
const child = spawn(probe, ['-d', distro, '--', 'bash', '-lc', command], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
  env: { ...cleanEnv, ...(bundle ? { SPEXCODE_BUNDLE_TARBALL: bundle } : {}) },
})
child.stdout.pipe(process.stdout)
child.stderr.pipe(process.stderr)
child.once('error', (error) => { console.error(`[wsl] ${error.message}`); process.exit(1) })
child.once('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
