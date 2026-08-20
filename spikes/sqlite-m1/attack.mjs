import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { driver, openProtocol, ProtocolError } from './protocol.mjs'

const root = mkdtempSync(join(tmpdir(), 'sqlite-m1-attack-'))
const databasePath = join(root, 'protocol.sqlite')
const resultPath = join(root, 'results.ndjson')
const worker = join(import.meta.dirname, 'worker.mjs')
const results = []
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const readResults = () => readFileSync(resultPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
const waitForResults = async count => { for (let i = 0; i < 100; i++) { if (existsSync(resultPath) && readResults().length >= count) return readResults(); await sleep(10) } throw new Error(`timed out waiting for ${count} result lines`) }
const start = (mode, session, id, env = {}, dbPath = databasePath) => spawn(process.execPath, ['--experimental-sqlite', worker, mode, dbPath, session, id || '', resultPath], { env: { ...process.env, ...env }, stdio: 'ignore' })
const waitExit = child => new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })) })
const killAndWait = async child => { child.kill('SIGKILL'); return waitExit(child) }
const record = (name, observed, detail = '') => results.push({ name, observed, detail })

const p = openProtocol(databasePath, { busyTimeoutMs: 1000 }); const session = 'attack-session'; p.initialize(session); const crashSession = 'crash-session'; p.initialize(crashSession)
record('driver/version', `${driver.name} ${driver.api} on Node ${driver.version}`)
record('explicit databasePath', databasePath)

// Two independent writers use the same absolute path; no process-local queue is involved.
const e1 = start('enqueue', session, 'proc-a'); const e2 = start('enqueue', session, 'proc-b'); await Promise.all([waitExit(e1), waitExit(e2)])
record('multiprocess enqueue', p.listPending(session).map(m => m.messageId).join(','), 'both independent writers committed')

// One pending head, two consumers: SQLite's write transaction supplies the single winner.
const raceSession = 'dequeue-race'; p.initialize(raceSession); const race = 'race-head'; p.enqueue(raceSession, { messageId: race, targetSessionId: raceSession, body: race })
const beforeRace = existsSync(resultPath) ? readResults().length : 0
const d1 = start('dequeue', raceSession, ''); const d2 = start('dequeue', raceSession, ''); await Promise.all([waitExit(d1), waitExit(d2)])
const raceResults = (await waitForResults(beforeRace + 2)).slice(-2)
record('concurrent dequeue', raceResults.filter(Boolean).filter(x => x.messageId === race).length === 1 ? 'one winner' : 'unexpected', JSON.stringify(raceResults.map(x => x?.messageId ?? null)))

// Kill while a transaction has changed the row but before COMMIT: SQLite rolls it back.
p.enqueue(crashSession, { messageId: 'precommit', targetSessionId: crashSession, body: 'precommit' }); const pre = start('precommit-lock', crashSession, ''); const preCount = existsSync(resultPath) ? readResults().length : 0
await waitForResults(preCount + 1); const preExit = await killAndWait(pre); record('SIGKILL before dequeue commit', p.listPending(crashSession).some(m => m.messageId === 'precommit') ? 'pending after rollback' : 'lost', `signal=${preExit.signal}`)

// Kill after the public dequeue returned: committed delivery is not requeued.
const post = start('post-dequeue-kill', crashSession, ''); const postCount = existsSync(resultPath) ? readResults().length : 0; const postLines = await waitForResults(postCount + 1); const postExit = await killAndWait(post); const postMessageId = postLines.at(-1)?.messageId
record('SIGKILL after dequeue commit', p.readMessages(crashSession).find(m => m.messageId === postMessageId)?.state === 'dequeued' ? 'dequeued/no-requeue' : 'lost', `signal=${postExit.signal}; returned=${postMessageId ?? null}`)

const db = new DatabaseSync(databasePath); const journalMode = Object.values(db.prepare('PRAGMA journal_mode').get())[0]; db.close()
record('WAL/SHM recovery', `${journalMode}; wal=${existsSync(`${databasePath}-wal`)} shm=${existsSync(`${databasePath}-shm`)}`, 'reopen/list after child kills succeeded')

// Hold a write transaction in one process; a second writer exhausts a deliberately tiny busy timeout.
const hold = start('hold-lock', session, '', { BUSY_TIMEOUT_MS: '1000' }); const holdCount = existsSync(resultPath) ? readResults().length : 0; await waitForResults(holdCount + 1)
const busy = start('enqueue', session, 'busy', { BUSY_TIMEOUT_MS: '50' }); await waitExit(busy); const busyResult = (await waitForResults(holdCount + 2)).at(-1); record('busy timeout', busyResult?.error === 'BUSY' ? 'BUSY (loud)' : JSON.stringify(busyResult), '50ms timeout')
await killAndWait(hold)

// Lost wake/backend absent: durable state is discoverable by a fresh process with no hint.
p.enqueue(session, { messageId: 'backend-absent', targetSessionId: session, body: 'offline' }); p.close(); const late = openProtocol(databasePath); record('lost wake/backend absent', late.listPending(session).some(m => m.messageId === 'backend-absent') ? 'discovered by query' : 'missing'); late.dequeue(session); late.close()

// Read-only open is readable but rejects all writes.
const ro = openProtocol(databasePath, { readOnly: true }); let roCode = 'none'; try { ro.enqueue(session, { messageId: 'ro', targetSessionId: session, body: 'ro' }) } catch (error) { roCode = error instanceof ProtocolError ? error.code : error.code }; ro.close(); record('readonly', roCode)

// SQLite backup/restore using the engine's own VACUUM INTO, then reopen the restored file.
const source = openProtocol(databasePath); const backupPath = join(root, 'backup.sqlite'); const backupDb = new DatabaseSync(databasePath); backupDb.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`); backupDb.close(); source.close(); const restored = openProtocol(backupPath); record('backup restore', restored.readMessages(session).length > 0 ? 'history restored' : 'empty'); restored.close()

// Corrupt fixture: an invalid SQLite image must not become an empty queue.
const corruptPath = join(root, 'corrupt.sqlite'); copyFileSync(databasePath, corruptPath); const bytes = readFileSync(corruptPath); bytes.fill(0, 100, Math.min(140, bytes.length)); writeFileSync(corruptPath, bytes); let corruptCode = 'none'; try { openProtocol(corruptPath) } catch (error) { corruptCode = error instanceof ProtocolError ? error.code : error.code }; record('corrupt storage', corruptCode)

// Retirement race: each round serializes either enqueue-before-retire or retire-before-enqueue.
const raceRoot = join(root, 'retire-race.sqlite'); const rp = openProtocol(raceRoot); rp.initialize('retire-race'); rp.close(); const rr1 = start('enqueue', 'retire-race', 'rr-enqueue', {}, raceRoot); const rr2 = start('retire', 'retire-race', '', {}, raceRoot); await Promise.all([waitExit(rr1), waitExit(rr2)]); const rr = existsSync(resultPath) ? readResults().slice(-2) : []; const rrp = openProtocol(raceRoot); const state = rrp.readMessages('retire-race').map(m => m.messageId); let retireRaceInvariant = state.length <= 1 && (rrp.listPending('retire-race').length === 0 || state[0] === 'rr-enqueue'); rrp.close(); record('retire race', retireRaceInvariant ? 'serialized; no resurrection' : 'unexpected', JSON.stringify(rr))

console.log(JSON.stringify({ driver, databasePath, results }, null, 2))
rmSync(root, { recursive: true, force: true })
