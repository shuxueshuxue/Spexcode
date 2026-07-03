// Regression proof for the "whole-screen underline on scroll" bug: a Claude Code pane emits OSC 8 hyperlinks
// (`\x1b]8;;URL\x1b\\text\x1b]8;;\x1b\\`, rendered underlined by xterm). When such a link's closing ST (`\x1b\\`)
// lands at the END of a captured row, the bridge used to run capture-reply bodies through stripDcs, whose
// trailing-`\x1b\\` strip ate the terminator — leaving the hyperlink unterminated so xterm never closed it and
// underlined the rest of the screen. This drives the REAL bridge (attachViewer + forwardWheel, the exact
// dashboard path): print a link line, scroll it into copy-mode history, and assert the repainted frame carries
// a PROPERLY TERMINATED OSC 8 close and never a bare `\x1b]8;;` at a line boundary.
//
// Run (from spec-cli/): SPEXCODE_TMUX=osc8-<pid> npx tsx test/pty-bridge.osc8.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { attachViewer, detachViewer, forwardWheel, type Viewer } from '../src/pty-bridge.js'

const pexec = promisify(execFile)
const SOCK = process.env.SPEXCODE_TMUX || `osc8-${process.pid}`
const SESSION = 'osc8'
const URL = 'https://pnpm.io/settings'
// a line whose OSC 8 close (`\x1b]8;;\x1b\\`) is the LAST thing on the row — the exact condition the strip broke.
const LINK_CMD = `printf '\\033]8;;${URL}\\033\\\\LINKTEXT\\033]8;;\\033\\\\\\n'`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function tmux(...args: string[]) { return pexec('tmux', ['-L', SOCK, ...args]) }

async function main() {
  await tmux('kill-session', '-t', SESSION).catch(() => {})
  await tmux('new-session', '-d', '-s', SESSION, '-x', '80', '-y', '10')

  const chunks: Buffer[] = []
  const viewer: Viewer = { send: (d) => { chunks.push(Buffer.from(d)) } }
  if (!attachViewer(SESSION, viewer, { cols: 80, rows: 10 })) throw new Error('attachViewer failed')
  await sleep(500)

  // emit the link, then push it up into tmux history with filler so a wheel-up must enter copy-mode to see it.
  await tmux('send-keys', '-t', SESSION, '-l', LINK_CMD); await tmux('send-keys', '-t', SESSION, 'Enter')
  await sleep(300)
  await tmux('send-keys', '-t', SESSION, '-l', 'for i in $(seq 1 30); do echo filler-$i; done'); await tmux('send-keys', '-t', SESSION, 'Enter')
  await sleep(600)
  chunks.length = 0   // drop the live-tail frames; keep only what the scroll repaints

  // wheel up until the link row is back in the copy-mode viewport (its history is ~30 lines up)
  for (let i = 0; i < 10; i++) { forwardWheel(SESSION, true, 40, 5, 1); await sleep(250) }
  await sleep(500)

  detachViewer(SESSION, viewer)
  await tmux('kill-session', '-t', SESSION).catch(() => {})

  const all = Buffer.concat(chunks)
  // 1) the link must have been repainted at all (proves we scrolled onto it)
  const sawLink = all.includes(Buffer.from(URL))
  // 2) every OSC 8 close in the stream must be properly ST-terminated: `\x1b]8;;\x1b\\` (or BEL) — NEVER a bare
  //    `\x1b]8;;` immediately followed by CR/LF/other (the truncation signature).
  let truncated = 0, properClose = 0
  for (let i = 0; i + 4 <= all.length; i++) {
    if (all[i] === 0x1b && all[i + 1] === 0x5d && all[i + 2] === 0x38 && all[i + 3] === 0x3b && all[i + 4] === 0x3b) { // \x1b]8;;
      const t0 = all[i + 5], t1 = all[i + 6]
      if (t0 === 0x1b && t1 === 0x5c) properClose++          // \x1b\\  ST
      else if (t0 === 0x07) properClose++                    // BEL
      else truncated++                                       // terminator missing → the bug
    }
  }
  console.log(`broadcast bytes     : ${all.length}`)
  console.log(`link repainted      : ${sawLink}`)
  console.log(`OSC8 closes proper  : ${properClose}`)
  console.log(`OSC8 closes trunc.  : ${truncated}`)

  if (!sawLink) { console.error('INCONCLUSIVE: never scrolled onto the link row — cannot prove the close survived'); process.exit(2) }
  if (truncated > 0) { console.error(`FAIL: ${truncated} OSC 8 close(s) lost their ST terminator — hyperlink leaks, whole-screen underline`); process.exit(1) }
  if (properClose === 0) { console.error('FAIL: no properly-terminated OSC 8 close seen where one was expected'); process.exit(1) }
  console.log('PASS: OSC 8 hyperlink closes survive the capture frame with their ST intact — no underline leak')
  process.exit(0)
}
main().catch((e) => { console.error('ERROR', e); process.exit(1) })
