// Runs the `spex` that npx put on PATH, in the working copy SPEXCODE_APP_ROOT names — never on the command line, see
// tools.js. npx itself runs outside that working copy
// (tools.js): inside a repository whose own package is called `spexcode` — SpexCode's own — npx takes the local
// package for the one it was asked to fetch, finds no `spex` linked there, and fails with `spex: command not found`.
import { spawnSync } from 'node:child_process'

const root = process.env.SPEXCODE_APP_ROOT
const args = process.argv.slice(2)
if (!root) {
  console.error('SPEXCODE_APP_ROOT is not set')
  process.exit(2)
}
const run = spawnSync('spex', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
if (run.error) {
  console.error(`spex could not start: ${run.error.message}`)
  process.exit(127)
}
process.exit(run.status ?? 1)
