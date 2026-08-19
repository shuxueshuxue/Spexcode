// Two questions about the second candidate binding:
//   1. in ONE process, do two different SQLite builds see each other's write lock?
//   2. across TWO processes, do they?
// The answer decides whether "which driver" is a per-call option or a process-global commitment.
//
//   npm install --no-save better-sqlite3
//   node probe-bs3-semantics.mjs
import { DatabaseSync } from 'node:sqlite'
import Database from 'better-sqlite3'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'bs3-probe-'))
const seed = path => {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('CREATE TABLE t(a INTEGER PRIMARY KEY, v TEXT NOT NULL) STRICT')
  db.close()
}

// --- 1. same process, two different SQLite builds
{
  const path = join(dir, 'same-process.sqlite')
  seed(path)
  const holder = new DatabaseSync(path)
  holder.exec('PRAGMA busy_timeout=50')
  holder.exec('BEGIN IMMEDIATE')
  holder.prepare('INSERT INTO t(v) VALUES(?)').run('holder')

  const other = new Database(path)
  other.pragma('busy_timeout = 50')
  const t0 = Date.now()
  try {
    other.exec('BEGIN IMMEDIATE')
    console.log(`same-process: better-sqlite3 ACQUIRED the write lock in ${Date.now() - t0}ms while node:sqlite held it`)
    console.log('             -> POSIX advisory locks are per-process, so two SQLite builds in one')
    console.log('                process cannot see each other. Mixing builds breaks single-writer.')
    other.exec('ROLLBACK')
  } catch (error) {
    console.log(`same-process: better-sqlite3 was refused after ${Date.now() - t0}ms: ${error.code}`)
  }
  holder.exec('ROLLBACK')
  holder.close()
  other.close()
}

// --- 2. two processes, two different SQLite builds
{
  const path = join(dir, 'two-process.sqlite')
  seed(path)
  const holderScript = join(dir, 'holder.mjs')
  writeFileSync(holderScript, `
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(process.argv[2])
db.exec('PRAGMA busy_timeout=50')
db.exec('BEGIN IMMEDIATE')
db.prepare('INSERT INTO t(v) VALUES(?)').run('holder')
process.stdout.write('held\\n')
const until = Date.now() + 2500
while (Date.now() < until) {}
db.exec('ROLLBACK')
db.close()
`)
  // Wait for the holder's own "held" line before testing: a holder that has not reached BEGIN
  // IMMEDIATE yet would make this probe report success for the wrong reason.
  const child = spawn(process.execPath, [holderScript, path], { stdio: ['ignore', 'pipe', 'pipe'] })
  const held = await new Promise((resolve, reject) => {
    let out = ''
    let err = ''
    child.stdout.on('data', d => { out += d; if (out.includes('held')) resolve(true) })
    child.stderr.on('data', d => { err += d })
    child.on('close', () => reject(new Error(`holder exited before holding: ${out}${err}`)))
  })
  console.log(`two-process: holder confirmed holding = ${held}`)

  const other = new Database(path)
  other.pragma('busy_timeout = 50')
  const t0 = Date.now()
  try {
    other.exec('BEGIN IMMEDIATE')
    console.log(`two-process: better-sqlite3 ACQUIRED the write lock in ${Date.now() - t0}ms -- unexpected`)
    other.exec('ROLLBACK')
  } catch (error) {
    console.log(`two-process: better-sqlite3 correctly refused after ${Date.now() - t0}ms: ${error.code} (${error.message})`)
    console.log('             -> across processes the two builds interoperate exactly as SQLite promises.')
  }
  other.close()
  child.kill('SIGKILL')
}

// --- 3. cross-build data visibility (unrelated to locking)
{
  const path = join(dir, 'visibility.sqlite')
  seed(path)
  const writer = new Database(path)
  writer.exec("INSERT INTO t(v) VALUES('from-better-sqlite3')")
  writer.close()
  const reader = new DatabaseSync(path)
  console.log('visibility: node:sqlite reads rows written by better-sqlite3 =',
    JSON.stringify(reader.prepare('SELECT v FROM t').all().map(r => r.v)))
  reader.close()
}

rmSync(dir, { recursive: true, force: true })
