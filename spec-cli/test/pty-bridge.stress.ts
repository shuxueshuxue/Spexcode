// Stress proof for the live native-client stream: the exact attachViewer path is flooded with enough CJK,
// box-drawing, and emoji lines to force multi-byte UTF-8 characters
// to straddle node-pty read boundaries — the condition that used to shatter them into U+FFFD. Assert the bytes
// that viewer receives, decoded as UTF-8, contain ZERO U+FFFD and the payload survives intact.
//
// Run (from spec-cli/): SPEXCODE_TMUX=stress-<pid> npx tsx test/pty-bridge.stress.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync } from 'node:fs'
import { attachViewer, detachViewer, resizeBridge, type Viewer } from '../src/pty-bridge.js'

const pexec = promisify(execFile)
const SOCK = process.env.SPEXCODE_TMUX || 'spexcode'
const SESSION = 'stress'
const LINE = '星★号😀笑脸└─[]─┘中文框线🀄🎉αβγ'   // 3-byte CJK/box + 4-byte emoji + 2-byte greek
const REPEATS = 6000                                   // ~150KB → many pty read chunks → guaranteed cross-boundary
// the echoed command line would itself contain a plain sentinel and falsely satisfy the wait, so build the
// marker from two shell string fragments: the command shows `FINISH''MARK`, only the OUTPUT shows FINISHMARK.
const SENTINEL = 'FINISHMARK'
const SENTINEL_CMD = "echo 'FINISH''MARK'"

async function tmux(...args: string[]) { return pexec('tmux', ['-L', SOCK, ...args]) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const payload = '/tmp/spex-stress-payload.txt'
  writeFileSync(payload, (LINE + '\n').repeat(REPEATS))   // one ~150KB file → one fast cat, still many pty reads
  await tmux('kill-session', '-t', SESSION).catch(() => {})
  await tmux('new-session', '-d', '-s', SESSION, '-x', '200', '-y', '49')

  const chunks: Buffer[] = []
  const viewer: Viewer = { send: (d) => { chunks.push(Buffer.from(d)) } }
  attachViewer(SESSION, viewer)
  resizeBridge(SESSION, viewer, 200, 50)

  const readyDeadline = Date.now() + 5000
  while (!chunks.length) {
    if (Date.now() > readyDeadline) throw new Error('timed out waiting for initial native frame')
    await sleep(20)
  }
  chunks.length = 0
  // Flood the pane; the helper carries the native tmux client's UTF-8 bytes without a second decoder.
  await tmux('send-keys', '-t', SESSION, '-l', `cat ${payload}; ${SENTINEL_CMD}`)
  await tmux('send-keys', '-t', SESSION, 'Enter')

  // wait until the sentinel shows up in this viewer's native stream (or time out)
  const deadline = Date.now() + 20000
  for (;;) {
    if (Buffer.concat(chunks).toString('utf8').includes(SENTINEL)) break
    if (Date.now() > deadline) throw new Error('timed out waiting for sentinel')
    await sleep(150)
  }
  await sleep(300)   // drain any trailing %output

  detachViewer(SESSION, viewer)
  await tmux('kill-session', '-t', SESSION).catch(() => {})

  const all = Buffer.concat(chunks)
  const text = all.toString('utf8')
  const fffd = (text.match(/�/g) || []).length
  const hits = text.split(LINE).length - 1

  console.log(`viewer bytes    : ${all.length}`)
  console.log(`payload copies  : ${hits} (flooded ${REPEATS})`)
  console.log(`U+FFFD count    : ${fffd}`)

  if (fffd !== 0) { console.error(`FAIL: ${fffd} U+FFFD replacement chars — UTF-8 was shattered`); process.exit(1) }
  if (hits < REPEATS * 0.9) { console.error(`FAIL: only ${hits} intact payload copies, expected ~${REPEATS}`); process.exit(1) }
  console.log('PASS: 0 U+FFFD, payload intact across the isolated native-client helper')
  process.exit(0)
}

main().catch((e) => { console.error('ERROR', e); process.exit(1) })
