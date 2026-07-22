// Regression proof for the whole-screen underline bug. A hyperlink close at the end of a row must survive
// the real native-client bridge and tmux copy-mode repaint with its ST terminator intact.
//
// Run: SPEXCODE_TMUX=osc8-<pid> npx tsx test/pty-bridge.osc8.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { attachViewer, detachViewer, forwardWheel, resizeBridge, type Viewer } from '../src/pty-bridge.js'

const pexec = promisify(execFile)
const SOCK = process.env.SPEXCODE_TMUX || `osc8-${process.pid}`
const SESSION = 'osc8'
const URL = 'https://pnpm.io/settings'
const LINK_CMD = `printf '\\033]8;;${URL}\\033\\\\LINKTEXT\\033]8;;\\033\\\\\\n'`
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const tmux = (...args: string[]) => pexec('tmux', ['-L', SOCK, ...args])

async function main(): Promise<void> {
  await tmux('kill-session', '-t', SESSION).catch(() => {})
  await tmux('new-session', '-d', '-s', SESSION, '-x', '80', '-y', '10')

  const chunks: Buffer[] = []
  const viewer: Viewer = { send: (data) => chunks.push(Buffer.from(data)) }
  try {
    attachViewer(SESSION, viewer)
    resizeBridge(SESSION, viewer, 80, 10)
    await sleep(500)
    chunks.length = 0
    await tmux('send-keys', '-t', SESSION, '-l', LINK_CMD); await tmux('send-keys', '-t', SESSION, 'Enter')
    await sleep(300)
    const live = Buffer.concat(chunks)
    const close = Buffer.from('\x1b]8;;\x1b\\')
    if (!live.includes(Buffer.from(URL)) || !live.includes(close)) {
      throw new Error('the live native stream did not preserve the hyperlink and its closing ST')
    }
    await tmux('send-keys', '-t', SESSION, '-l', 'for i in $(seq 1 30); do echo filler-$i; done'); await tmux('send-keys', '-t', SESSION, 'Enter')
    await sleep(600)
    chunks.length = 0

    for (let index = 0; index < 40; index++) {
      forwardWheel(SESSION, viewer, true, 40, 5, 1)
      await sleep(80)
    }
    await sleep(500)

    const all = Buffer.concat(chunks)
    const sawText = all.includes(Buffer.from('LINKTEXT'))
    let properClose = 0, truncatedClose = 0
    const output = Buffer.concat([live, all])
    for (let index = 0; index < output.length; index++) {
      if (output.subarray(index, index + close.length).equals(close)) properClose++
      if (output.subarray(index, index + 6).equals(Buffer.from('\x1b]8;;\r')) ||
          output.subarray(index, index + 6).equals(Buffer.from('\x1b]8;;\n'))) truncatedClose++
    }
    console.log(`viewer bytes: ${output.length}; history text: ${sawText}; closes: ${properClose}; truncated: ${truncatedClose}`)
    if (!sawText) throw new Error('never scrolled onto the hyperlink row')
    if (truncatedClose > 0) throw new Error(`${truncatedClose} OSC 8 close(s) lost their ST terminator`)
    if (properClose === 0) throw new Error('no properly terminated OSC 8 close was rendered')
    console.log('PASS: OSC 8 hyperlink closes survive the native tmux stream')
  } finally {
    detachViewer(SESSION, viewer)
    await tmux('kill-session', '-t', SESSION).catch(() => {})
  }
}

main().catch((error) => { console.error('FAIL:', error); process.exit(1) })
