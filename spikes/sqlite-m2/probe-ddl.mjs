// DDL/behaviour probes that decide specific freeze items. Every line is measured, never recalled.
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, statfsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sqlite-m2-ddl-'))
const say = (k, v) => console.log(`${k}: ${v}`)

// --- 1. STRICT precision: what really happens binding a JS number into a TEXT column?
{
  const db = new DatabaseSync(join(dir, 'strict.sqlite'))
  db.exec('CREATE TABLE t (id TEXT NOT NULL PRIMARY KEY, n INTEGER NOT NULL) STRICT')
  let note = ''
  try {
    db.prepare('INSERT INTO t(id,n) VALUES(?,?)').run(7, 1)
    const row = db.prepare('SELECT id, typeof(id) AS ty FROM t').get()
    note = `accepted; stored=${JSON.stringify(row.id)} typeof=${row.ty}`
  } catch (e) { note = 'rejected: ' + e.message }
  say('strict.text_column_given_js_number', note)
  try {
    db.prepare('INSERT INTO t(id,n) VALUES(?,?)').run('x', 'not-a-number')
    say('strict.int_column_given_text', 'ACCEPTED')
  } catch (e) { say('strict.int_column_given_text', 'rejected: ' + e.message.slice(0, 90)) }
  try {
    db.prepare('INSERT INTO t(id,n) VALUES(?,?)').run('y', '42')
    const r = db.prepare("SELECT n, typeof(n) ty FROM t WHERE id='y'").get()
    say('strict.int_column_given_numeric_text', `accepted stored=${r.n} typeof=${r.ty}`)
  } catch (e) { say('strict.int_column_given_numeric_text', 'rejected: ' + e.message.slice(0, 90)) }
  db.close()
}

// --- 2. GLOB negated class support (the session_id charset CHECK depends on it)
{
  const db = new DatabaseSync(join(dir, 'glob.sqlite'))
  db.exec("CREATE TABLE g (id TEXT NOT NULL PRIMARY KEY CHECK (id NOT GLOB '*[^0-9A-Za-z_-]*' AND id NOT GLOB '-*' AND length(id) BETWEEN 1 AND 128)) STRICT")
  const tries = [
    'ok-id_9',
    'de57398c-0150-454e-805f-27f02f8e477f',
    '../etc/passwd',
    'a/b',
    'a.b',
    'has space',
    '-leading',
    'a' + String.fromCharCode(92) + 'b',
    'n' + String.fromCharCode(0xe4) + 'me',
    '.',
    '..',
  ]
  for (const v of tries) {
    try { db.prepare('INSERT INTO g(id) VALUES(?)').run(v); say(`glob.accept ${JSON.stringify(v)}`, 'ACCEPTED') }
    catch { say(`glob.accept ${JSON.stringify(v)}`, 'rejected') }
  }
  db.close()
}

// --- 3. fs.statfs: is network-filesystem detection possible from pure Node?
{
  say('statfs.available', typeof statfsSync)
  for (const p of [dir, '/', process.env.HOME || '/home']) {
    try { say(`statfs ${p}`, JSON.stringify(statfsSync(p))) } catch (e) { say(`statfs ${p}`, 'FAIL ' + e.message) }
  }
}

// --- 4. Symlinked paths to one database: does SQLite still see one committed state?
{
  const real = join(dir, 'real.sqlite')
  const link = join(dir, 'link.sqlite')
  const a = new DatabaseSync(real)
  a.exec('PRAGMA journal_mode=WAL')
  a.exec('CREATE TABLE m (id INTEGER PRIMARY KEY, v TEXT NOT NULL) STRICT')
  a.prepare('INSERT INTO m(v) VALUES(?)').run('via-real')
  symlinkSync(real, link)
  const b = new DatabaseSync(link)
  const seen = b.prepare('SELECT v FROM m').all().map(r => r.v)
  b.prepare('INSERT INTO m(v) VALUES(?)').run('via-link')
  const backOnA = a.prepare('SELECT v FROM m ORDER BY id').all().map(r => r.v)
  say('symlink.reader_through_link_sees', JSON.stringify(seen))
  say('symlink.writer_through_link_visible_on_real', JSON.stringify(backOnA))
  a.close(); b.close()
}

// --- 5. UTF-16 (JS default sort) vs UTF-8 byte order divergence for header keys
{
  const keys = [String.fromCodePoint(0xff3a), String.fromCodePoint(0x10000)]
  const utf16 = [...keys].sort()
  const utf8 = [...keys].sort((x, y) => Buffer.compare(Buffer.from(x, 'utf8'), Buffer.from(y, 'utf8')))
  const cp = a => a.map(s => 'U+' + s.codePointAt(0).toString(16).toUpperCase())
  say('sortorder.utf16_default', JSON.stringify(cp(utf16)))
  say('sortorder.utf8_bytes', JSON.stringify(cp(utf8)))
  say('sortorder.DIVERGES', String(JSON.stringify(utf16) !== JSON.stringify(utf8)))
}

// --- 6. readMessages plan: does the partial pending index serve full-history reads?
{
  const db = new DatabaseSync(join(dir, 'plan.sqlite'))
  db.exec(`CREATE TABLE protocol_messages (
    enqueue_seq INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    target_session_id TEXT NOT NULL,
    dequeued_at_ms INTEGER
  ) STRICT;
  CREATE INDEX pending_fifo ON protocol_messages(target_session_id, enqueue_seq) WHERE dequeued_at_ms IS NULL;`)
  const plan = sql => db.prepare('EXPLAIN QUERY PLAN ' + sql).all().map(r => r.detail).join(' | ')
  say('plan.head_pending', plan("SELECT * FROM protocol_messages WHERE target_session_id='s' AND dequeued_at_ms IS NULL ORDER BY enqueue_seq LIMIT 1"))
  say('plan.list_pending', plan("SELECT * FROM protocol_messages WHERE target_session_id='s' AND dequeued_at_ms IS NULL ORDER BY enqueue_seq"))
  say('plan.read_history_NO_extra_index', plan("SELECT * FROM protocol_messages WHERE target_session_id='s' AND enqueue_seq>0 ORDER BY enqueue_seq"))
  db.exec('CREATE INDEX history ON protocol_messages(target_session_id, enqueue_seq)')
  say('plan.read_history_WITH_extra_index', plan("SELECT * FROM protocol_messages WHERE target_session_id='s' AND enqueue_seq>0 ORDER BY enqueue_seq"))
  db.close()
}

// --- 7. quick_check cost vs database size (is it affordable on every open?)
{
  const path = join(dir, 'big.sqlite')
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('PRAGMA synchronous=OFF')
  db.exec('CREATE TABLE big (id INTEGER PRIMARY KEY AUTOINCREMENT, sid TEXT NOT NULL, body BLOB NOT NULL) STRICT')
  const ins = db.prepare('INSERT INTO big(sid, body) VALUES(?,?)')
  const payload = Buffer.alloc(200, 7)
  let have = 0
  for (const n of [1000, 10000, 100000]) {
    db.exec('BEGIN IMMEDIATE')
    for (; have < n; have++) ins.run('s', payload)
    db.exec('COMMIT')
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    let t = process.hrtime.bigint()
    const qc = Object.values(db.prepare('PRAGMA quick_check').get())[0]
    const qcMs = Number(process.hrtime.bigint() - t) / 1e6
    t = process.hrtime.bigint()
    const probe = new DatabaseSync(path, { readOnly: true }); probe.close()
    const openMs = Number(process.hrtime.bigint() - t) / 1e6
    say(`cost.rows=${n}`, `quick_check=${qcMs.toFixed(1)}ms (${qc})  plain_open=${openMs.toFixed(2)}ms`)
  }
  db.close()
}

// --- 8. read-only open of a WAL database
{
  const p = join(dir, 'ro.sqlite')
  const w = new DatabaseSync(p)
  w.exec('PRAGMA journal_mode=WAL')
  w.exec('CREATE TABLE t(a INTEGER PRIMARY KEY) STRICT')
  w.prepare('INSERT INTO t(a) VALUES(1)').run()
  w.close()
  try {
    const ro = new DatabaseSync(p, { readOnly: true })
    say('readonly.wal_open', 'ok, rows=' + ro.prepare('SELECT count(*) c FROM t').get().c)
    try { ro.exec('PRAGMA journal_mode=WAL'); say('readonly.set_journal_mode', 'accepted') }
    catch (e) { say('readonly.set_journal_mode', 'rejected: ' + e.message.slice(0, 80)) }
    ro.close()
  } catch (e) { say('readonly.wal_open', 'FAIL ' + e.message) }
}

rmSync(dir, { recursive: true, force: true })
