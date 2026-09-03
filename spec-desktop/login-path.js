'use strict'

// A GUI launch hands the shell an environment that never sourced the user's shell profile: launchd gives a
// macOS app `/usr/bin:/bin:/usr/sbin:/sbin`, and a Linux .desktop entry is no better. Homebrew, nvm and
// ~/.local/bin are all outside that, so every tool the product resolves through PATH — tmux, and each agent
// CLI a launcher names — reads as missing, and the host card reports a machine that looks bare while the
// user's terminal on the same machine has everything. The shell repairs its OWN environment once, before it
// spawns the gateway, because it is the process that was started without a profile.

const { execFileSync } = require('node:child_process')

// rc files print banners, so the PATH is announced after a marker and everything before it is noise.
const MARKER = '__SPEXCODE_LOGIN_PATH__'
const PROBE_TIMEOUT_MS = 5_000

function dirs(value) {
  return String(value || '').split(':').filter(Boolean)
}

// The tell-tale of a GUI launch is that there is no controlling terminal: that is what "double-clicked"
// means. Judging by the shape of PATH instead does not work — the measured Mac's launchd session injects
// ~/.cargo/bin, so a PATH that looks personalized can still be one no profile ever touched. A process with a
// tty already inherited the shell that started it, so the probe cost is paid only where it buys something.
function needsLoginPath(platformName, hasTty) {
  if (platformName !== 'darwin' && platformName !== 'linux') return false
  return !hasTty
}

// Login dirs win: they carry the version manager the user actually runs. The inherited system dirs stay,
// so a login shell that resolves nothing can never leave the app with less PATH than it started with.
function mergePath(currentPath, loginPath) {
  const seen = new Set()
  return [...dirs(loginPath), ...dirs(currentPath)].filter((dir) => !seen.has(dir) && seen.add(dir)).join(':')
}

function parseLoginPath(stdout) {
  const at = String(stdout || '').lastIndexOf(MARKER)
  return at === -1 ? '' : stdout.slice(at + MARKER.length).trim()
}

function loginShellCommand(shell) {
  return { file: shell || '/bin/sh', args: ['-ilc', `printf %s ${MARKER}"$PATH"`] }
}

// Repairs env.PATH in place and returns what happened, so a failure is reported rather than swallowed: a
// bare-looking host is then a fact about the probe, not a silent lie about the machine.
function repairLoginPath(env = process.env, platformName = process.platform, run = execFileSync, hasTty = Boolean(process.stdout?.isTTY || process.stdin?.isTTY)) {
  if (!needsLoginPath(platformName, hasTty)) return { needed: false, repaired: false, reason: 'started from a terminal' }
  const { file, args } = loginShellCommand(env.SHELL)
  let printed = ''
  try {
    printed = parseLoginPath(run(file, args, { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] }))
  } catch (err) {
    return { needed: true, repaired: false, reason: `${file} did not answer: ${err.message}` }
  }
  if (!printed) return { needed: true, repaired: false, reason: `${file} printed no PATH` }
  env.PATH = mergePath(env.PATH, printed)
  return { needed: true, repaired: true, reason: `read from ${file}` }
}

module.exports = { needsLoginPath, mergePath, parseLoginPath, loginShellCommand, repairLoginPath }
