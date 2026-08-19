// v1 uses a rollback journal (journal_mode=DELETE), not WAL. Everything WAL gave us for free has to
// be re-measured under DELETE rather than carried over. Nothing here is inferred from the WAL runs.
import { DatabaseSync } from 'node:sqlite'
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sqlite-m2-delete-'))
const say = (k, v) => console.log(`${k}: ${v}`)
const seed = (path, mode) => {
  const db = new DatabaseSync(path)
  if (mode) db.prepare(`PRAGMA journal_mode=${mode}`).get()
  db.exec('CREATE TABLE IF NOT EXISTS t(a INTEGER PRIMARY KEY, v TEXT NOT NULL) STRICT')
  db.close()
}

// --- 1. What journal mode does a brand-new database actually report?
{
  const path = join(dir, 'fresh.sqlite')
  const db = new DatabaseSync(path)
  say('fresh.default_journal_mode_before_any_write', db.prepare('PRAGMA journal_mode').get().journal_mode)
  db.exec('CREATE TABLE t(a INTEGER PRIMARY KEY) STRICT')
  say('fresh.default_journal_mode_after_ddl', db.prepare('PRAGMA journal_mode').get().journal_mode)
  db.close()
  const reopened = new DatabaseSync(path)
  say('fresh.journal_mode_on_reopen', reopened.prepare('PRAGMA journal_mode').get().journal_mode)
  reopened.close()
  say('fresh.sidecar_files', JSON.stringify(readdirSync(dir).filter(f => f.startsWith('fresh'))))
}

// --- 2. Can the assertion actually catch a database somebody left in WAL?
{
  const path = join(dir, 'legacy-wal.sqlite')
  seed(path, 'WAL')
  const db = new DatabaseSync(path)
  say('legacy-wal.reported_mode', db.prepare('PRAGMA journal_mode').get().journal_mode)
  db.close()
}

// --- 3. Does PRAGMA journal_mode=DELETE honour busy_timeout? (WAL did not.)
{
  const path = join(dir, 'modeswitch.sqlite')
  seed(path, 'WAL')
  const holderScript = join(dir, 'holder.mjs')
  writeFileSync(holderScript, `
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(process.argv[2])
db.exec('PRAGMA busy_timeout=50')
db.exec('BEGIN IMMEDIATE')
db.prepare('INSERT INTO t(v) VALUES(?)').run('holder')
process.stdout.write('held\\n')
const until = Date.now() + 2000
while (Date.now() < until) {}
db.exec('ROLLBACK'); db.close()
`)
  const child = spawn(process.execPath, [holderScript, path], { stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((resolve, reject) => {
    let out = ''
    child.stdout.on('data', d => { out += d; if (out.includes('held')) resolve() })
    child.on('close', () => reject(new Error('holder exited before holding')))
  })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA busy_timeout=1500')
  const t0 = Date.now()
  try {
    const got = db.prepare('PRAGMA journal_mode=DELETE').get().journal_mode
    say('modeswitch.delete_under_contention', `returned ${got} after ${Date.now() - t0}ms`)
  } catch (error) {
    say('modeswitch.delete_under_contention', `REFUSED after ${Date.now() - t0}ms: ${error.message} (busy_timeout was 1500)`)
  }
  db.close()
  child.kill('SIGKILL')
}

// --- 4. DELETE concurrency: does a reader block a writer, and a writer block a reader?
{
  const path = join(dir, 'concurrency.sqlite')
  seed(path, 'DELETE')
  const writer = new DatabaseSync(path)
  writer.exec('PRAGMA busy_timeout=100')
  const reader = new DatabaseSync(path)
  reader.exec('PRAGMA busy_timeout=100')

  writer.exec('BEGIN IMMEDIATE')
  writer.prepare('INSERT INTO t(v) VALUES(?)').run('uncommitted')
  try {
    const rows = reader.prepare('SELECT count(*) AS c FROM t').get().c
    say('delete.read_during_open_write', `allowed, saw ${Number(rows)} row(s)`)
  } catch (error) {
    say('delete.read_during_open_write', `BLOCKED: ${error.message}`)
  }
  writer.exec('COMMIT')

  reader.exec('BEGIN')
  reader.prepare('SELECT count(*) AS c FROM t').get()
  try {
    writer.exec('BEGIN IMMEDIATE')
    writer.prepare('INSERT INTO t(v) VALUES(?)').run('during-read')
    writer.exec('COMMIT')
    say('delete.write_during_open_read', 'allowed')
  } catch (error) {
    say('delete.write_during_open_read', `BLOCKED: ${error.message}`)
    try { writer.exec('ROLLBACK') } catch {}
  }
  reader.exec('COMMIT')
  writer.close(); reader.close()
}

// --- 5. Which sidecar files exist while a write transaction is open, and after commit?
{
  const path = join(dir, 'sidecar.sqlite')
  seed(path, 'DELETE')
  const db = new DatabaseSync(path)
  const listing = () => JSON.stringify(readdirSync(dir).filter(f => f.startsWith('sidecar')).sort())
  say('sidecar.at_rest', listing())
  db.exec('BEGIN IMMEDIATE')
  db.prepare('INSERT INTO t(v) VALUES(?)').run('x')
  say('sidecar.during_write_transaction', listing())
  db.exec('COMMIT')
  say('sidecar.after_commit', listing())
  db.close()
  say('sidecar.after_close', listing())
}

rmSync(dir, { recursive: true, force: true })
