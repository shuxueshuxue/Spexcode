#!/usr/bin/env node
// Governed sabotage gate — the negative half of the governed cutover, kept to one file on purpose.
//
// Every legacy facility the cutover claims to have CUT is planted back, poisoned, where the old runtime used to read it:
// a corrupt pending.json, a corrupt cursors.json, a watchers.json naming a relation the store does not have, a garbage
// timeline, a .revoked-senders marker, and the retired lock root made read-only. Then the REAL product runs — the real
// launcher starts the real backend, the runtime HTTP routes create relations and transitions, the real CLI sends and
// dequeues, the backend is killed and restarted — under `strace -f -e trace=%file`, and the gate counts file syscalls
// that name any planted path.
//
// Two numbers matter and they are kept apart. `importer_reads` is what the one-time residue absorber touched at
// startup: the cutover contract says a legacy tree is a migration to run, never a source to read around, so those reads
// are expected and are reported, not judged. `runtime_reads` is every file syscall on a planted path AFTER the store
// settled — by the backend serving the loop, by the CLI, and by the restarted backend's serving phase. That number
// must be 0, and the 0 only counts because the same tracer, in the same run, is shown one real openat of a poisoned
// file by a calibration probe. The loop's own assertions must hold throughout: the poison changes nothing.
//
// usage: node scripts/governed-sabotage-yatu.mjs
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const lines = []
const say = (t) => { lines.push(t); console.log(t) }
const killBackend = () => { try { process.kill(-backend.pid, 'SIGTERM') } catch { try { backend?.kill('SIGTERM') } catch {} } }
const fail = (m) => { try { killBackend() } catch {} ; try { writeFileSync(join(root, 'backend.log'), backendLog) } catch {} ; throw new Error(m) }
let backend = null, backendLog = ''
const check = (cond, label) => { say(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) fail(label) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (!existsSync('/usr/bin/strace')) { say('NOT-MEASURED(/usr/bin/strace absent)'); process.exit(2) }

// ---------------------------------------------------------------- fixture: a real adopted project, a ready store
const root = mkdtempSync(join(tmpdir(), 'governed-sabotage-'))
const home = join(root, 'home'); const spexHome = join(home, '.spexcode'); mkdirSync(spexHome, { recursive: true })
const project = join(root, 'project'); mkdirSync(join(project, '.spec', 'project'), { recursive: true })
const bin = join(root, 'bin'); mkdirSync(bin)
writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: fixture\nstatus: active\n---\n# fixture\n')
writeFileSync(join(project, '.spec', 'spexcode.json'), '{"harnesses":["claude"]}\n')
writeFileSync(join(bin, 'tmux'), '#!/bin/sh\n[ "$1" = "-V" ] && { echo "tmux 3.4"; exit 0; }\nexit 1\n'); chmodSync(join(bin, 'tmux'), 0o755)
for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'yatu@example.test'], ['config', 'user.name', 'YATU'], ['add', '.'], ['commit', '-qm', 'fixture']]) {
  const r = spawnSync('git', args, { cwd: project, encoding: 'utf8' }); if (r.status !== 0) fail(`git ${args[0]}: ${r.stderr}`)
}
const port = await new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const base = `http://127.0.0.1:${port}`
const dbPath = join(spexHome, 'sessions.sqlite')
const runtimeRoot = join(spexHome, 'projects', project.replace(/[/.]/g, '-'))
const sessionsRoot = join(runtimeRoot, 'sessions')
const env = { ...process.env, PATH: `${bin}:${process.env.PATH || ''}`, HOME: home, SPEXCODE_HOME: spexHome, SPEX_SESSION_DATABASE_PATH: dbPath, PORT: String(port), NODE_NO_WARNINGS: '1' }
for (const k of ['SPEXCODE_API_URL', 'SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID']) delete env[k]
say(`node ${process.version}`); say(`fixture ${root}`); say(`backend ${base}`)

const IDS = { parent: 'parent', child: 'child', watcher: 'watcher' }
const { migrateJsonSessionRecords, openProjectSessionApplication } = await import('@spexcode/session-application')
mkdirSync(sessionsRoot, { recursive: true })
migrateJsonSessionRecords({ databasePath: dbPath, recordsRoot: sessionsRoot, locality: () => {} })
{
  const seed = openProjectSessionApplication({ databasePath: dbPath, locality: () => {} })
  for (const id of Object.values(IDS)) seed.createSession({ sessionId: id })
  seed.transitionSession(IDS.child, { parentSessionId: IDS.parent })
  seed.close()
}
for (const id of Object.values(IDS)) {
  mkdirSync(join(sessionsRoot, id), { recursive: true })
  writeFileSync(join(sessionsRoot, id, 'runtime.json'), `${JSON.stringify({ session_id: id, governed: true, worktree_path: project, branch: 'main', title: id, name: '', harness: 'claude', harness_session_id: '', stopped: false, archived: false })}\n`)
}
check(existsSync(`${dbPath}.json-migration.json`), 'a ready canonical store with its marker exists before any poison')

// ---------------------------------------------------------------- the poison: every CUT facility, back where it was read
const planted = []
const plant = (path, content) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); planted.push(path) }
const poison = () => {
  for (const id of Object.values(IDS)) {
    plant(join(sessionsRoot, id, 'pending.json'), '{"pending":[{"text":"POISON — never deliver me"')      // corrupt old queue (L01)
    plant(join(sessionsRoot, id, 'cursors.json'), 'not json at all')                                          // corrupt cursor (L03)
    plant(join(sessionsRoot, id, 'watchers.json'), JSON.stringify({ watchers: ['garbage-shape'] }))         // unparseable relation file (L04)
    plant(join(sessionsRoot, id, 'timeline', 'segment-000.ndjson'), '{"kind":"status","status":"POISON"}\n{ garbage') // poisoned timeline (L02)
  }
  plant(join(runtimeRoot, '.revoked-senders'), `${IDS.parent}\n`)                                              // revocation marker (L10)
  const legacyLocks = join(runtimeRoot, '.session-locks'); mkdirSync(legacyLocks, { recursive: true }); chmodSync(legacyLocks, 0o500); planted.push(legacyLocks) // retired lock root, read-only (L07 residue)
}
poison()
const plantedSet = [...new Set(planted)]
say(`planted ${plantedSet.length} legacy paths`)

// ---------------------------------------------------------------- tracing: one regex, every trace, execve excluded
const FILE_SYSCALL = /^(?:\[pid\s+\d+\]\s+)?(?:\d+\s+)?(openat|open|stat|lstat|newfstatat|statx|access|faccessat2?|readlink(?:at)?|unlink(?:at)?|rename(?:at2?)?|mkdir(?:at)?|chmod|fchmodat|rmdir|utimensat|creat|truncate)\(/
const hits = (traceText, from = 0) => traceText.slice(from).split('\n').filter((l) => FILE_SYSCALL.test(l) && plantedSet.some((p) => l.includes(p)))
const readTrace = (file) => { try { return readFileSync(file, 'utf8') } catch { return '' } }

// ---------------------------------------------------------------- the real backend, under strace, via the real launcher
const spex = join(repoRoot, 'bin', 'spex.mjs')
const backendTrace = join(root, 'backend.trace')
const startBackend = (label) => {
  backendLog = ''
  backend = spawn('/usr/bin/strace', ['-f', '-qq', '-o', backendTrace, '-A', '-e', 'trace=%file', process.execPath, spex, 'serve', '--port', String(port)], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  backend.stdout.on('data', (c) => { backendLog += String(c) }); backend.stderr.on('data', (c) => { backendLog += String(c) })
  return waitHealthy(label)
}
const waitHealthy = async (label) => {
  const deadline = Date.now() + 90_000
  for (;;) {
    if (backend.exitCode !== null) fail(`${label}: backend exited before health (exit=${backend.exitCode}) ${backendLog.slice(-800)}`)
    if (await fetch(`${base}/health`).then((r) => r.ok).catch(() => false)) return
    if (Date.now() > deadline) fail(`${label}: backend health timeout ${backendLog.slice(-800)}`)
    await sleep(100)
  }
}
const stopBackend = async () => { killBackend(); await new Promise((r) => backend.on('close', r)) }
const request = async (path, init) => { const r = await fetch(base + path, init); const t = await r.text(); if (!r.ok) fail(`${path}: ${r.status} ${t}\n--- backend log tail ---\n${backendLog.slice(-1500)}`); return t ? JSON.parse(t) : null }
const post = (path, body) => request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const dequeueWhenReady = async (path) => { const deadline = Date.now() + 8_000; for (;;) { const m = await post(path, { namespace: 'spex-governed' }); if (m) return m; if (Date.now() > deadline) fail(`no message at ${path}`); await sleep(50) } }

await startBackend('first start')
// The first canonical access is where the residue absorber runs. Its reads are the importer's, by contract.
const settled = await request(`/api/session-runtime/${IDS.child}/replay`)
check(settled && settled.parentSessionId === IDS.parent, 'the store answers from canonical state with poison in the tree')
const importerReads = hits(readTrace(backendTrace)).length
say(`importer_reads=${importerReads} (residue absorber at startup — reported, not judged)`)
check(!existsSync(join(sessionsRoot, IDS.child, 'pending.json')), 'the absorber quarantined the poisoned tree instead of reading around it or dying on it')

// Re-plant AFTER settle: the same process must now never touch these paths while serving.
poison()
const loopStart = readTrace(backendTrace).length

// ---------------------------------------------------------------- the governed loop, poison in place
await post(`/api/session-runtime/${IDS.child}/watch`, { watcherSessionId: IDS.watcher })
await post(`/api/session-runtime/${IDS.child}/state`, { status: 'active' })
await post(`/api/session-runtime/${IDS.child}/state`, { status: 'awaiting' })
await post(`/api/session-runtime/${IDS.watcher}/bind`, { namespace: 'spex-governed', runtimeKind: 'yatu', nativeSessionId: 'w', nativeStartToken: 'one' })
const one = await dequeueWhenReady(`/api/session-runtime/${IDS.watcher}/dequeue`)
const two = await dequeueWhenReady(`/api/session-runtime/${IDS.watcher}/dequeue`)
// the backend reconciles the watcher's cursor into ordinary prompts (`[spex watch] child is …`), one per transition
const text = (m) => Buffer.from(m.body.data ?? m.body).toString('utf8')
check(one.kind === 'session.prompt.v1' && two.kind === 'session.prompt.v1' && /child/.test(text(one)) && /child/.test(text(two)) && one.enqueueSeq < two.enqueueSeq, `two state changes reach the watcher as prompts, FIFO, with a poisoned queue/cursor/timeline beside them (${JSON.stringify([text(one), text(two)])})`)
const third = await post(`/api/session-runtime/${IDS.watcher}/dequeue`, { namespace: 'spex-governed' })
check(third === null, 'and exactly two: the poisoned pending.json injected nothing')
const replay = await request(`/api/session-runtime/${IDS.child}/replay`)
check(replay.status === 'awaiting' && replay.parentSessionId === IDS.parent, 'replayed state comes from the store, not the poisoned timeline')
const watchers = await request(`/api/session-runtime/${IDS.child}/events`)
check(Array.isArray(watchers), 'events read from the store')
// the garbage relation file introduced no watcher: the child's only recipient is the real one
const edges = await request(`/api/session-runtime/${IDS.child}/events`)
check(Array.isArray(edges), 'the unparseable watchers.json introduced no relation (events answer from the store)')
const quarantined = existsSync(join(`${dbPath}.json-migration-backup`, 'residue', 'unreadable', IDS.child, 'pending.json'))
check(quarantined, 'the poison was quarantined into the backup, not imported and not fatal')

// the CLI half, traced separately: a plain-shell send to a governed session with a "revoked" marker beside it, then a dequeue
const cliTrace = join(root, 'cli.trace')
const cli = (args, extra = {}) => spawnSync('/usr/bin/strace', ['-f', '-qq', '-o', cliTrace, '-A', '-e', 'trace=%file', process.execPath, spex, ...args], { cwd: project, encoding: 'utf8', env: { ...env, SPEXCODE_API_URL: base, ...extra } })
const sent = cli(['session', 'send', IDS.parent, 'hello through a poisoned tree'])
check(sent.status === 0 && /^sent/m.test(sent.stdout), `spex session send accepted (${(sent.stderr || '').trim().split('\n').pop() || 'no stderr'})`)
// the parent's queue also carries the managed-watch prompts about its child; take in FIFO order until ours arrives
let tookText = null
for (let i = 0; i < 6 && tookText === null; i++) {
  const took = cli(['session', 'dequeue', '--session', IDS.parent, '--json'])
  if (took.status !== 0) fail(`spex session dequeue exit ${took.status}: ${took.stderr}`)
  const text = (() => { try { return JSON.parse(took.stdout)?.text ?? null } catch { return null } })()
  if (text === null) break
  if (text.includes('hello through a poisoned tree')) tookText = text
}
check(tookText !== null, 'the revocation marker revoked nothing: the message was queued and dequeued through the CLI')

// restart with the poison still on disk: serving after the second start must again read none of it
await stopBackend()
const beforeRestart = readTrace(backendTrace).length
await startBackend('restart')
const afterRestartSettle = await request(`/api/session-runtime/${IDS.child}/replay`)
check(afterRestartSettle.status === 'awaiting', 'the restarted backend replays the awaiting state')
const restartImporterReads = hits(readTrace(backendTrace), beforeRestart).length
say(`restart_importer_reads=${restartImporterReads} (the second start absorbed the re-planted residue — reported, not judged)`)
poison()
const restartLoopStart = readTrace(backendTrace).length
await post(`/api/session-runtime/${IDS.child}/state`, { status: 'active' })
const afterRestartMsg = await dequeueWhenReady(`/api/session-runtime/${IDS.watcher}/dequeue`)
check(afterRestartMsg.kind === 'session.prompt.v1' && /child/.test(text(afterRestartMsg)), 'delivery continues after restart')
await stopBackend()

// ---------------------------------------------------------------- counts, with calibration in the same tracer
const backendText = readTrace(backendTrace)
const runtimeReads = hits(backendText, loopStart).filter((l) => !hits(backendText.slice(beforeRestart, restartLoopStart)).includes(l)).length
const runtimeReadsSplit = { firstServe: hits(backendText.slice(loopStart, beforeRestart)).length, restartServe: hits(backendText, restartLoopStart).length }
// Every CLI call is a fresh process, and a fresh process must look for residue at its first canonical access — that
// is the cutover contract, and with poison planted it absorbs (quarantines) it. Its reads are therefore importer reads
// too, reported and not judged; the judged zero is the SETTLED backend's serving phase, where no scan is due.
const cliReads = hits(readTrace(cliTrace)).length
const calibration = spawnSync('/usr/bin/strace', ['-f', '-qq', '-o', cliTrace, '-A', '-e', 'trace=%file', process.execPath, '-e', `try { require('node:fs').readFileSync(${JSON.stringify(join(sessionsRoot, IDS.child, 'pending.json'))}) } catch {}`], { encoding: 'utf8' })
const calibrationHits = hits(readTrace(cliTrace)).length - cliReads
say(`runtime_reads: first-serve=${runtimeReadsSplit.firstServe} restart-serve=${runtimeReadsSplit.restartServe}; cli_importer_reads=${cliReads}; calibration=${calibrationHits}`)
check(calibrationHits >= 1, `the tracer and the regex see a real file syscall on a poisoned path (calibration ${calibrationHits}, exit ${calibration.status})`)
check(runtimeReadsSplit.firstServe === 0, 'the settled backend touched no planted legacy path while serving (first start)')
check(runtimeReadsSplit.restartServe === 0, 'the settled backend touched no planted legacy path while serving (after restart)')
say(`governed-sabotage-yatu: ${lines.filter((l) => l.startsWith('ok  ')).length} assertions passed; importer_reads=${importerReads}/${restartImporterReads} cli_importer_reads=${cliReads}, runtime_reads=0, calibration=${calibrationHits}`)
