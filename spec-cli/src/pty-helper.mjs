import * as pty from 'node-pty'
import { execFileSync } from 'node:child_process'

const [id, colsArg, rowsArg] = process.argv.slice(2)
const cols = Number(colsArg)
const rows = Number(rowsArg)
const socket = process.env.SPEXCODE_TMUX || 'spexcode'

if (!id || !(cols > 0 && rows > 0)) {
  process.stderr.write('ERROR invalid helper arguments\n')
  process.exit(2)
}

// Establish the outer-terminal contract before this process owns a PTY. tmux must preserve hyperlinks and
// wrap client updates in DEC 2026 for xterm 6; doing the setup before forkpty preserves helper isolation.
try {
  // The dashboard renders the pane, not tmux's client chrome. Keeping this as a tmux session option makes
  // the requested PTY grid the pane grid too; filtering a coloured final row in xterm would corrupt real
  // pane content. SpexCode owns these sessions, so a later foreground attach sees the same status-free pane.
  execFileSync('tmux', ['-L', socket, 'set-option', '-t', id, 'status', 'off'])
  execFileSync('tmux', ['-L', socket, 'set-option', '-g', 'mouse', 'on'])
  execFileSync('tmux', ['-L', socket, 'set-option', '-g', 'history-limit', '50000'])
  const features = execFileSync('tmux', ['-L', socket, 'show-options', '-gsv', 'terminal-features'], { encoding: 'utf8' })
  const xtermFeatures = new Set(features.split('\n').filter((line) => line.startsWith('xterm*:')).flatMap((line) => line.split(':').slice(1)))
  const missing = ['sync', 'hyperlinks'].filter((feature) => !xtermFeatures.has(feature))
  if (missing.length) {
    execFileSync('tmux', ['-L', socket, 'set-option', '-as', 'terminal-features', `,xterm*:${missing.join(':')}`])
  }
} catch { /* attach below fails loudly if the tmux server/session is unavailable */ }

const terminal = pty.spawn('tmux', ['-u', '-L', socket, 'attach-session', '-t', id], {
  name: 'xterm-256color',
  cols,
  rows,
  env: { ...process.env, LANG: process.env.LANG || 'en_US.UTF-8' },
})

terminal.onData((data) => process.stdout.write(Buffer.from(data, 'utf8')))
terminal.onExit(({ exitCode }) => process.exit(exitCode === 0 ? 0 : 1))
process.stderr.write(`READY ${terminal.pid}\n`)

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  input += chunk
  let newline
  while ((newline = input.indexOf('\n')) >= 0) {
    const line = input.slice(0, newline)
    input = input.slice(newline + 1)
    if (!line) continue
    try {
      const message = JSON.parse(line)
      if (message?.t === 'resize' && message.cols > 0 && message.rows > 0) {
        const nextCols = Math.floor(message.cols)
        const nextRows = Math.floor(message.rows)
        terminal.resize(nextCols, nextRows)
        process.stderr.write(`RESIZED ${nextCols} ${nextRows}\n`)
      } else if (message?.t === 'wheel') {
        // tmux's client renderer requests the classic X10 mouse protocol from its outer terminal and then
        // translates it for the pane (including SGR when the application owns mouse input).
        const col = Math.max(1, Math.min(223, Math.floor(message.col) || 1))
        const row = Math.max(1, Math.min(223, Math.floor(message.row) || 1))
        const ticks = Math.max(1, Math.min(10, Math.floor(message.ticks) || 1))
        const button = message.up ? 64 : 65
        terminal.write(`\x1b[M${String.fromCharCode(button + 32, col + 32, row + 32)}`.repeat(ticks))
      }
    } catch { /* malformed controls cannot become terminal input */ }
  }
})

let closing = false
function close() {
  if (closing) return
  closing = true
  try { terminal.kill() } catch { /* already gone */ }
  setTimeout(() => process.exit(0), 100).unref()
}
process.stdin.on('end', close)
process.on('SIGTERM', close)
process.on('SIGINT', close)
