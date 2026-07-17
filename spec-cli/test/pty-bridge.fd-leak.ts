// Regression proof for the tmux-server-wide wedge that blacked out every dashboard terminal: each bridge
// client must start with a CLEAN fd table — its stdio and nothing else.
//
// The wedge: node-pty's Linux path is forkpty(3), which hands back a master fd with no FD_CLOEXEC and then
// execs without closing inherited fds. So every bridge client spawned AFTER another one inherited that
// other one's pty master — a staircase (client N holds masters 0..N-1). When a bridge died, its own master
// closed but the copies living inside sibling clients kept the pts alive, so the slave never hit EIO, tmux
// never dropped the dead client, its tty write buffer filled, and the tmux SERVER's event loop blocked
// forever in one write(2) — freezing every control-mode bridge on the socket at once (all panes black).
//
// This drives the REAL bridge (attachViewer, the exact dashboard path) for several sessions on one socket,
// then reads each spawned tmux client's own /proc fd table. A client holding ANY pty master, or any fd
// beyond its stdio, is the leak. Linux-only: /proc is the measurement surface, and it is also the only
// platform with the defect (node-pty's macOS path spawns with POSIX_SPAWN_CLOEXEC_DEFAULT).
//
// Run (from spec-cli/): SPEXCODE_TMUX=fdleak-<pid> npx tsx test/pty-bridge.fd-leak.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdirSync, readlinkSync, readFileSync } from 'node:fs'
import { attachViewer, detachViewer, type Viewer } from '../src/pty-bridge.js'

const pexec = promisify(execFile)
const SOCK = process.env.SPEXCODE_TMUX || `fdleak-${process.pid}`
const SESSIONS = ['fd-a', 'fd-b', 'fd-c', 'fd-d']
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function tmux(...args: string[]) { return pexec('tmux', ['-L', SOCK, ...args]) }

// what a process actually holds open, straight from the kernel — the same surface the incident was traced on.
function fdTable(pid: number): { fd: number; target: string }[] {
  return readdirSync(`/proc/${pid}/fd`).map((fd) => {
    let target = '?'
    try { target = readlinkSync(`/proc/${pid}/fd/${fd}`) } catch { /* raced away */ }
    return { fd: Number(fd), target }
  }).sort((a, b) => a.fd - b.fd)
}

// the pids of the tmux control clients the bridge spawned — our own children, one per attached session.
// Filtered by cmdline: this process has other children (transient `tmux` execs, tooling), and only the
// long-lived control clients are the subject.
async function bridgeClientPids(): Promise<number[]> {
  const { stdout } = await pexec('pgrep', ['-P', String(process.pid)]).catch(() => ({ stdout: '' }))
  const kids = stdout.split('\n').map((s) => Number(s.trim())).filter((n) => n > 0)
  return kids.filter((pid) => {
    try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('attach-session') } catch { return false }
  })
}

async function main() {
  if (process.platform !== 'linux') { console.log('SKIP: /proc fd measurement is Linux-only'); return }
  for (const s of SESSIONS) {
    await tmux('kill-session', '-t', s).catch(() => {})
    await tmux('new-session', '-d', '-s', s, '-x', '80', '-y', '24')
  }

  // spawn the bridges in order, exactly as a board load does — the ordering is what built the staircase.
  const viewers: Viewer[] = []
  for (const s of SESSIONS) {
    const v: Viewer = { send: () => {} }
    viewers.push(v)
    if (!attachViewer(s, v, { cols: 80, rows: 24 })) throw new Error(`attachViewer failed for ${s}`)
    await sleep(300)
  }
  await sleep(500)

  const pids = await bridgeClientPids()
  console.log(`bridge client pids  : ${pids.join(', ') || '(none)'}`)
  if (pids.length < SESSIONS.length) throw new Error(`expected ${SESSIONS.length} clients, saw ${pids.length}`)

  // what THIS process holds. A child fd (beyond its own stdio) pointing at any of these is an inherited fd —
  // the defect. tmux's own post-exec fds (its server socket, its self-pipe) are legitimately its own and
  // alias nothing of ours, so this measures inheritance rather than merely counting open files.
  const ours = new Set(fdTable(process.pid).map((f) => f.target))

  let leakedMasters = 0, inherited = 0
  for (const [i, pid] of pids.entries()) {
    const fds = fdTable(pid)
    const masters = fds.filter((f) => f.target.includes('ptmx'))
    const fromUs = fds.filter((f) => f.fd > 2 && ours.has(f.target))
    leakedMasters += masters.length
    inherited += fromUs.length
    console.log(`client #${i} pid=${pid} fds=[${fds.map((f) => `${f.fd}->${f.target}`).join(' ')}]`)
    console.log(`           inherited pty masters=${masters.length} fds inherited from us=${fromUs.length}` +
                (fromUs.length ? ` [${fromUs.map((f) => `${f.fd}->${f.target}`).join(' ')}]` : ''))
  }

  for (const [i, s] of SESSIONS.entries()) { detachViewer(s, viewers[i]) }
  await sleep(200)
  await tmux('kill-server').catch(() => {})

  console.log(`\ntotal inherited pty masters : ${leakedMasters} (expected 0)`)
  console.log(`total fds inherited from us : ${inherited} (expected 0)`)
  if (leakedMasters > 0 || inherited > 0) {
    console.log(`FAIL: a bridge client inherited fds it must not hold — a dead sibling's pty master keeps its`)
    console.log(`      pts alive, so tmux blocks writing to a client that will never drain: the server-wide wedge.`)
    process.exit(1)
  }
  console.log('PASS: every bridge client holds only its stdio — no inherited pty master, nothing to wedge the tmux server')
}

main().catch((e) => { console.error(e); process.exit(1) })
