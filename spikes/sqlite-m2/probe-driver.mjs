// Driver capability probe. Prints one JSON object on stdout. Runs under any Node.
// Every field is measured, never asserted from memory.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = {
  node: process.versions.node,
  execArgv: process.execArgv,
  module: null,
  moduleError: null,
  exports: [],
  features: {},
}

const probe = (name, fn) => {
  try {
    out.features[name] = { ok: true, value: fn() }
  } catch (error) {
    out.features[name] = { ok: false, error: String(error?.code || '') + ':' + String(error?.message || error).slice(0, 200) }
  }
}

let sqlite
try {
  sqlite = await import('node:sqlite')
  out.module = 'node:sqlite'
  out.exports = Object.keys(sqlite).sort()
} catch (error) {
  out.moduleError = String(error?.code || '') + ':' + String(error?.message || error).slice(0, 300)
  console.log(JSON.stringify(out, null, 2))
  process.exit(0)
}

const dir = mkdtempSync(join(tmpdir(), 'sqlite-m2-probe-'))
const dbPath = join(dir, 'probe.sqlite')
let db
try {
  db = new sqlite.DatabaseSync(dbPath)

  probe('sqlite_version', () => db.prepare('SELECT sqlite_version() AS v').get().v)
  probe('sqlite_source_id', () => db.prepare('SELECT sqlite_source_id() AS v').get().v)
  probe('journal_mode_wal', () => db.prepare('PRAGMA journal_mode=WAL').get().journal_mode)
  probe('busy_timeout', () => { db.exec('PRAGMA busy_timeout=5000'); return db.prepare('PRAGMA busy_timeout').get().timeout })
  probe('foreign_keys_on', () => { db.exec('PRAGMA foreign_keys=ON'); return db.prepare('PRAGMA foreign_keys').get().foreign_keys })
  probe('synchronous_full', () => { db.exec('PRAGMA synchronous=FULL'); return db.prepare('PRAGMA synchronous').get().synchronous })
  probe('data_version', () => db.prepare('PRAGMA data_version').get().data_version)
  probe('quick_check', () => Object.values(db.prepare('PRAGMA quick_check').get())[0])

  probe('strict_table', () => {
    db.exec('CREATE TABLE s (a TEXT NOT NULL, b INTEGER NOT NULL) STRICT')
    return 'created'
  })
  probe('strict_enforced', () => {
    try {
      db.prepare('INSERT INTO s(a,b) VALUES(?,?)').run(1, 2)
      return 'NOT-ENFORCED: integer accepted into TEXT column'
    } catch (error) { return 'enforced: ' + String(error.message).slice(0, 120) }
  })
  probe('autoincrement', () => {
    db.exec('CREATE TABLE ai (seq INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT NOT NULL) STRICT')
    db.prepare('INSERT INTO ai(v) VALUES(?)').run('x')
    db.prepare('INSERT INTO ai(v) VALUES(?)').run('y')
    db.exec('DELETE FROM ai WHERE seq=2')
    db.prepare('INSERT INTO ai(v) VALUES(?)').run('z')
    return db.prepare('SELECT seq FROM ai ORDER BY seq').all().map(r => Number(r.seq)).join(',')
  })
  probe('partial_index', () => {
    db.exec('CREATE TABLE p (id INTEGER PRIMARY KEY, sid TEXT NOT NULL, seq INTEGER NOT NULL, done INTEGER) STRICT')
    db.exec('CREATE INDEX p_pending ON p(sid, seq) WHERE done IS NULL')
    const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM p WHERE sid=? AND done IS NULL ORDER BY seq LIMIT 1").all('a')
    return plan.map(r => r.detail).join(' | ')
  })
  probe('json_valid_json_type', () => {
    db.exec("CREATE TABLE j (h TEXT NOT NULL CHECK (json_valid(h) AND json_type(h)='object')) STRICT")
    db.prepare('INSERT INTO j(h) VALUES(?)').run('{"a":"b"}')
    let rejectedArray = false
    try { db.prepare('INSERT INTO j(h) VALUES(?)').run('["a"]') } catch { rejectedArray = true }
    let rejectedGarbage = false
    try { db.prepare('INSERT INTO j(h) VALUES(?)').run('not json') } catch { rejectedGarbage = true }
    return `object-ok rejectArray=${rejectedArray} rejectGarbage=${rejectedGarbage}`
  })
  probe('unique_null_coexists', () => {
    db.exec('CREATE TABLE u (sid TEXT NOT NULL, k TEXT, UNIQUE (sid, k)) STRICT')
    db.prepare('INSERT INTO u(sid,k) VALUES(?,?)').run('s', null)
    db.prepare('INSERT INTO u(sid,k) VALUES(?,?)').run('s', null)
    db.prepare('INSERT INTO u(sid,k) VALUES(?,?)').run('s', null)
    let dupNonNull = false
    db.prepare('INSERT INTO u(sid,k) VALUES(?,?)').run('s', 'k1')
    try { db.prepare('INSERT INTO u(sid,k) VALUES(?,?)').run('s', 'k1') } catch { dupNonNull = true }
    const n = db.prepare('SELECT count(*) AS c FROM u WHERE k IS NULL').get().c
    return `nullRowsAccepted=${Number(n)} duplicateNonNullRejected=${dupNonNull}`
  })
  probe('blob_roundtrip', () => {
    db.exec('CREATE TABLE b (id INTEGER PRIMARY KEY, v BLOB NOT NULL) STRICT')
    const bytes = new Uint8Array([0, 1, 2, 255, 0, 128])
    db.prepare('INSERT INTO b(id,v) VALUES(?,?)').run(1, bytes)
    const got = db.prepare('SELECT v FROM b WHERE id=1').get().v
    return `${got?.constructor?.name} len=${got?.byteLength ?? got?.length} equal=${Buffer.compare(Buffer.from(got), Buffer.from(bytes)) === 0}`
  })
  probe('returning_clause', () => {
    const row = db.prepare('INSERT INTO b(id,v) VALUES(?,?) RETURNING id').get(2, new Uint8Array([9]))
    return `id=${Number(row.id)}`
  })
  probe('vacuum_into', () => {
    const target = join(dir, 'backup.sqlite')
    db.exec(`VACUUM INTO '${target}'`)
    const copy = new sqlite.DatabaseSync(target, { readOnly: true })
    const n = copy.prepare('SELECT count(*) AS c FROM ai').get().c
    copy.close()
    return `rows=${Number(n)}`
  })
  probe('backup_api', () => {
    if (typeof sqlite.backup !== 'function') return 'ABSENT: node:sqlite exports no backup()'
    return 'present (async function)'
  })
  probe('readonly_open', () => {
    const ro = new sqlite.DatabaseSync(dbPath, { readOnly: true })
    let wrote = 'rejected'
    try { ro.exec('INSERT INTO ai(v) VALUES(\'ro\')'); wrote = 'ACCEPTED' } catch (error) { wrote = 'rejected: ' + String(error.message).slice(0, 80) }
    ro.close()
    return wrote
  })
  probe('begin_immediate', () => {
    db.exec('BEGIN IMMEDIATE'); db.exec('COMMIT'); return 'ok'
  })
  probe('session_extension', () => (typeof sqlite.Session === 'function' ? 'present' : 'absent'))
  probe('changes_bigint', () => {
    const r = db.prepare('UPDATE ai SET v=? WHERE seq=1').run('q')
    return `changes=${r.changes} (${typeof r.changes}) lastInsertRowid=${typeof r.lastInsertRowid}`
  })
} finally {
  try { db?.close() } catch {}
  console.log(JSON.stringify(out, null, 2))
  try { rmSync(dir, { recursive: true, force: true }) } catch {}
}
