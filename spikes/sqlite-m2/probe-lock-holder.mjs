// Can a lock be held DETERMINISTICALLY, so the busy_timeout ordering claim becomes a pass/fail
// vector instead of a race that has to be run repeatedly and hoped over?
//
// The four things that must be true for the design to work:
//   1. PRAGMA locking_mode=EXCLUSIVE + a write keeps the file lock after COMMIT.
//   2. Another connection's first database-touching statement is refused when busy_timeout is 0.
//   3. `PRAGMA busy_timeout=N` itself does NOT need the lock -- otherwise the correct order would
//      fail too and the vector could not distinguish the orders at all.
//   4. With busy_timeout > the hold duration, that same statement blocks and then succeeds.
import { DatabaseSync } from 'node:sqlite'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sqlite-m2-lock-'))
const path = join(dir, 'protocol.sqlite')
const say = (k, v) => console.log(`${k}: ${v}`)

const seed = new DatabaseSync(path)
seed.exec('CREATE TABLE t(a INTEGER PRIMARY KEY, v TEXT NOT NULL) STRICT')
seed.prepare('INSERT INTO t(v) VALUES(?)').run('seed')
seed.close()

const holderScript = join(dir, 'holder.mjs')
writeFileSync(holderScript, `
import { DatabaseSync } from 'node:sqlite'
const [path, holdMs] = [process.argv[2], Number(process.argv[3])]
const db = new DatabaseSync(path)
db.exec('PRAGMA locking_mode=EXCLUSIVE')
db.exec('BEGIN IMMEDIATE')
db.prepare('INSERT INTO t(v) VALUES(?)').run('holder')
db.exec('COMMIT')
process.stdout.write('held\\n')
const until = Date.now() + holdMs
while (Date.now() < until) {}
db.close()
process.stdout.write('released\\n')
`)

const startHolder = holdMs => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [holderScript, path, String(holdMs)], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let err = ''
  child.stdout.on('data', d => { out += d; if (out.includes('held')) resolve(child) })
  child.stderr.on('data', d => { err += d })
  child.on('close', () => reject(new Error(`holder exited before holding: ${out}${err}`)))
})

// --- 1 & 2 & 3: lock held, busy_timeout 0 vs busy_timeout set first
{
  const holder = await startHolder(4000)
  const db = new DatabaseSync(path)

  // (3) does setting busy_timeout itself need the lock?
  let pragmaOk = 'yes'
  try { db.exec('PRAGMA busy_timeout=0') } catch (e) { pragmaOk = 'NO: ' + e.message }
  say('setting busy_timeout while EXCLUSIVE is held', pragmaOk)

  // (2) first database-touching statement with no busy handler
  let t = Date.now()
  try {
    db.prepare('SELECT sqlite_version() AS v').get()
    say('probe with busy_timeout=0', `SUCCEEDED after ${Date.now() - t}ms -- lock is NOT blocking it`)
  } catch (e) {
    say('probe with busy_timeout=0', `refused after ${Date.now() - t}ms: ${e.code ?? ''} ${e.message}`)
  }

  // same connection, now with a budget shorter than the remaining hold
  db.exec('PRAGMA busy_timeout=300')
  t = Date.now()
  try {
    db.prepare('SELECT sqlite_version() AS v').get()
    say('probe with busy_timeout=300 (hold outlasts it)', `SUCCEEDED after ${Date.now() - t}ms`)
  } catch (e) {
    say('probe with busy_timeout=300 (hold outlasts it)', `refused after ${Date.now() - t}ms: ${e.code ?? ''}`)
  }
  db.close()
  holder.kill('SIGKILL')
}

// --- 4: budget longer than the hold -> blocks, then succeeds
{
  const HOLD = 700
  const holder = await startHolder(HOLD)
  const db = new DatabaseSync(path)
  db.exec('PRAGMA busy_timeout=5000')
  const t = Date.now()
  try {
    const v = db.prepare('SELECT sqlite_version() AS v').get().v
    const waited = Date.now() - t
    say(`probe with busy_timeout=5000 (hold ${HOLD}ms)`,
      `succeeded after ${waited}ms (sqlite ${v}) -- waited for the holder: ${waited >= HOLD * 0.5}`)
  } catch (e) {
    say(`probe with busy_timeout=5000 (hold ${HOLD}ms)`, `REFUSED after ${Date.now() - t}ms: ${e.code ?? ''} ${e.message}`)
  }
  db.close()
  holder.kill('SIGKILL')
}

rmSync(dir, { recursive: true, force: true })
