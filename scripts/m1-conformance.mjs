// M1 cross-layer conformance harness.
//
// It measures the SIX scenarios on the `session-protocol` node — the contract's own M1 conformance
// vectors — through freshly packed tarballs installed into a clean consumer OUTSIDE this repository.
// Nothing here imports a workspace source file: if a resolution ever escapes the consumer's own
// node_modules the run fails, because "installed" has to be a measured fact and not a claim.
//
// It is a measurement harness, not product code and not a test suite: it exists so the readings it
// produces can be reproduced by someone who does not have this session's context.
//
// usage: node scripts/m1-conformance.mjs [--keep]
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const keep = process.argv.includes('--keep')
const lines = []
const say = text => { lines.push(text); console.log(text) }
const fail = message => { throw new Error(message) }
const check = (condition, label) => {
  say(`${condition ? 'ok  ' : 'FAIL'} ${label}`)
  if (!condition) fail(label)
}

// ---------------------------------------------------------------- clean consumer
// Outside the repository on purpose: inside it, npm walks up, finds the monorepo workspaces, and the
// "installed" proof silently becomes a workspace proof.
const root = mkdtempSync(join(tmpdir(), 'm1-conformance-'))
const consumer = join(root, 'consumer')
mkdirSync(consumer)
writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'm1-conformance-consumer', private: true, version: '0.0.0', type: 'module' }))

const npm = (args, cwd) => {
  const result = spawnSync('npm', args, { cwd, encoding: 'utf8', env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' } })
  if (result.status !== 0) fail(`npm ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  return result.stdout
}

const PACKAGES = ['session-protocol', 'session-topology', 'session-selflaunch']
  .filter(name => existsSync(join(repoRoot, 'packages', name, 'package.json')))

say(`node ${process.version}`)
say(`consumer ${consumer}`)
const tarballs = []
for (const name of PACKAGES) {
  const dir = join(repoRoot, 'packages', name)
  npm(['run', 'build'], dir)
  const packed = JSON.parse(npm(['pack', '--json', '--pack-destination', root], dir))[0]
  tarballs.push(join(root, packed.filename))
  say(`tarball ${packed.name} ${packed.filename} shasum=${packed.shasum}`)
}
npm(['install', '--no-audit', '--no-fund', ...tarballs], consumer)

// Every later child runs from a cwd, HOME and config root that are all different from each other and
// from the database, so nothing can quietly pick storage out of the environment (scenario 6).
const elsewhere = join(root, 'elsewhere'); mkdirSync(elsewhere)
const fakeHome = join(root, 'fake-home'); mkdirSync(fakeHome)
const dbRoot = join(root, 'databases'); mkdirSync(dbRoot)

const runNode = (source, { cwd = elsewhere, env = {}, expectFail = false } = {}) => {
  const file = join(root, `step-${lines.length}.mjs`)
  writeFileSync(file, source)
  const result = spawnSync(process.execPath, [file], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: fakeHome, NODE_PATH: join(consumer, 'node_modules'), ...env },
  })
  const stdout = result.stdout.trim()
  if (!expectFail && result.status !== 0) fail(`child failed: ${result.stderr}`)
  return { status: result.status, stdout, stderr: result.stderr }
}

// A child resolves the packages by NAME from the consumer's node_modules; the harness never hands it
// a source path. `createRequire` is anchored at the consumer so resolution cannot fall back here.
const preamble = `
import { createRequire } from 'node:module'
const require = createRequire(${JSON.stringify(join(consumer, 'package.json'))})
const protocolEntry = require.resolve('@spexcode/session-protocol')
if (!protocolEntry.startsWith(${JSON.stringify(join(consumer, 'node_modules'))})) {
  throw new Error('resolution escaped the consumer: ' + protocolEntry)
}
const { openProtocol, ProtocolError, applyComponentMigrations } = await import(protocolEntry)
`

const db = name => join(dbRoot, `${name}.sqlite`)

// ---------------------------------------------------------------- 1. installed-sqlite-package-contract
say('')
say('# scenario installed-sqlite-package-contract')
{
  const path = db('contract')
  const first = runNode(`${preamble}
    const p = openProtocol(${JSON.stringify(path)})
    p.initialize('addr_one')
    p.enqueue('addr_one', { kind: 'a.v1', body: Buffer.from('A') })
    p.enqueue('addr_one', { kind: 'a.v1', body: Buffer.from('B') })
    console.log(JSON.stringify({ entry: protocolEntry, pending: p.listPending('addr_one').map(m => Buffer.from(m.body).toString()) }))
    p.close()
  `)
  const observed = JSON.parse(first.stdout)
  check(observed.entry.includes('node_modules/@spexcode/session-protocol'), `resolved from the consumer: ${observed.entry}`)
  check(!observed.entry.includes(repoRoot), 'no workspace-source fallback')
  check(JSON.stringify(observed.pending) === '["A","B"]', 'process 1 wrote A then B')

  // A SECOND process against the same absolute path must see one committed authority, drain it, keep
  // history, and retire only once the queue is empty.
  const second = runNode(`${preamble}
    const p = openProtocol(${JSON.stringify(path)})
    const seen = [p.dequeue('addr_one'), p.dequeue('addr_one'), p.dequeue('addr_one')]
    const history = p.readMessages('addr_one')
    const retired = p.retire('addr_one')
    let afterRetire = null
    try { p.enqueue('addr_one', { kind: 'a.v1', body: Buffer.from('C') }) } catch (e) { afterRetire = e.code }
    console.log(JSON.stringify({
      bodies: seen.slice(0, 2).map(m => Buffer.from(m.body).toString()),
      third: seen[2],
      historyBodies: history.map(m => Buffer.from(m.body).toString()),
      historyDequeued: history.map(m => m.dequeuedAtMs !== null),
      tombstone: retired.retiredAtMs !== null,
      afterRetire,
      pendingOnRetired: p.listPending('addr_one').length,
    }))
    p.close()
  `)
  const r = JSON.parse(second.stdout)
  check(JSON.stringify(r.bodies) === '["A","B"]', 'process 2 dequeued A then B in order')
  check(r.third === null, 'an empty queue on a known active address is null')
  check(JSON.stringify(r.historyBodies) === '["A","B"]', 'history keeps both in stable sequence')
  check(r.historyDequeued.every(Boolean), 'history reports their dequeued state')
  check(r.tombstone, 'retirement leaves an auditable tombstone')
  check(r.afterRetire === 'PROTOCOL_SESSION_RETIRED', 'enqueue after retirement fails as retired')
  check(r.pendingOnRetired === 0, 'a retired address still answers listPending')
}

// ---------------------------------------------------------------- 2. schema-migration-is-one-portable-authority
say('')
say('# scenario schema-migration-is-one-portable-authority')
{
  const path = db('migration')
  const replay = runNode(`${preamble}
    const a = openProtocol(${JSON.stringify(path)}); a.initialize('mig'); a.close()
    const b = openProtocol(${JSON.stringify(path)})
    const rows = b.withTransaction(tx => tx.query("SELECT component, version, checksum FROM schema_migrations ORDER BY component, version"))
    b.close()
    console.log(JSON.stringify(rows))
  `)
  const rows = JSON.parse(replay.stdout)
  check(rows.length === 1 && rows[0].component === 'session-protocol' && rows[0].version === 1,
    'a fresh open and an exact replay converge on one migration row')

  const drifted = db('checksum-drift')
  const driftRun = runNode(`${preamble}
    const seed = openProtocol(${JSON.stringify(drifted)}); seed.initialize('mig'); seed.close()
    const raw = openProtocol(${JSON.stringify(drifted)})
    raw.withTransaction(tx => tx.exec("UPDATE schema_migrations SET checksum='0000' WHERE component='session-protocol'"))
    raw.close()
    let code = null, read = null
    try { const p = openProtocol(${JSON.stringify(drifted)}); read = p.listPending('mig') } catch (e) { code = e.code }
    console.log(JSON.stringify({ code, read }))
  `)
  const drift = JSON.parse(driftRun.stdout)
  check(drift.code === 'PROTOCOL_SCHEMA_CHECKSUM_MISMATCH', 'a rewritten checksum fails loudly')
  check(drift.read === null, 'it fails BEFORE any protocol read, not as an empty database')

  const future = db('future-generation')
  const futureRun = runNode(`${preamble}
    const seed = openProtocol(${JSON.stringify(future)}); seed.initialize('mig'); seed.close()
    const raw = openProtocol(${JSON.stringify(future)})
    raw.withTransaction(tx => tx.exec("INSERT INTO schema_migrations(component,version,checksum,applied_at_ms) VALUES('session-protocol',2,'ff',1)"))
    raw.close()
    let code = null, read = null
    try { const p = openProtocol(${JSON.stringify(future)}); read = p.listPending('mig') } catch (e) { code = e.code }
    console.log(JSON.stringify({ code, read }))
  `)
  const fut = JSON.parse(futureRun.stdout)
  check(fut.code === 'PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED', 'a future generation is refused, not half-understood')
  check(fut.read === null, 'it too fails before any protocol read')
}

// ---------------------------------------------------------------- 3. fifo-idempotency-and-retirement
say('')
say('# scenario fifo-idempotency-and-retirement')
{
  const path = db('fifo')
  const run = runNode(`${preamble}
    const p = openProtocol(${JSON.stringify(path)})
    p.initialize('fifo')
    const msg = (body, key) => ({ kind: 'k.v1', body: Buffer.from(body), ...(key ? { idempotencyKey: key } : {}) })
    const a = p.enqueue('fifo', msg('A', 'key-a'))
    const b = p.enqueue('fifo', msg('B'))
    const replay = p.enqueue('fifo', msg('A', 'key-a'))
    let conflict = null
    const before = p.listPending('fifo').length
    try { p.enqueue('fifo', msg('A!', 'key-a')) } catch (e) { conflict = e.code }
    const after = p.listPending('fifo').length
    let nonEmptyRetire = null
    try { p.retire('fifo') } catch (e) { nonEmptyRetire = e.code }
    const stillPending = p.listPending('fifo').map(m => Buffer.from(m.body).toString())
    const drained = [p.dequeue('fifo'), p.dequeue('fifo'), p.dequeue('fifo')]
    const tomb = p.retire('fifo')
    let resurrect = null, laterEnqueue = null
    try { p.initialize('fifo') } catch (e) { resurrect = e.code }
    try { p.enqueue('fifo', msg('C')) } catch (e) { laterEnqueue = e.code }
    console.log(JSON.stringify({
      replaySame: replay.messageId === a.messageId && replay.enqueueSeq === a.enqueueSeq,
      distinct: a.messageId !== b.messageId,
      conflict, mutated: before !== after,
      nonEmptyRetire, stillPending,
      drainedOrder: drained.slice(0, 2).map(m => Buffer.from(m.body).toString()),
      thirdIsNull: drained[2] === null,
      tombstone: tomb.retiredAtMs !== null,
      resurrect, laterEnqueue,
      historyAfterRetire: p.readMessages('fifo').length,
    }))
    p.close()
  `)
  const r = JSON.parse(run.stdout)
  check(r.replaySame, 'exact idempotent replay returns the original row')
  check(r.conflict === 'PROTOCOL_IDEMPOTENCY_CONFLICT', 'the same key with one changed byte conflicts')
  check(!r.mutated, 'the conflicting reuse changed no state')
  check(r.nonEmptyRetire === 'PROTOCOL_RETIRE_NON_EMPTY', 'retirement with pending work fails atomically')
  check(JSON.stringify(r.stillPending) === '["A","B"]', 'the failed retirement left the queue intact')
  check(JSON.stringify(r.drainedOrder) === '["A","B"]', 'dequeue order is A then B')
  check(r.thirdIsNull, 'the drained queue answers null')
  check(r.tombstone && r.resurrect === 'PROTOCOL_SESSION_RETIRED' && r.laterEnqueue === 'PROTOCOL_SESSION_RETIRED',
    'the tombstone is terminal for initialize and enqueue alike')
  check(r.historyAfterRetire === 2, 'history stays readable after retirement')
}

// ---------------------------------------------------------------- 4. concurrent-dequeue-has-one-commit-winner
say('')
say('# scenario concurrent-dequeue-has-one-commit-winner')
{
  const path = db('race')
  runNode(`${preamble}
    const p = openProtocol(${JSON.stringify(path)})
    p.initialize('race')
    p.enqueue('race', { kind: 'r.v1', body: Buffer.from('only-one') })
    p.close()
  `)
  // Four independent OS processes released against one shared wall-clock barrier. The assertion is on
  // the SET of outcomes, not on timing: exactly one body, three nulls.
  const racer = `${preamble}
    const startAt = Number(process.env.START_AT)
    while (Date.now() < startAt) {}
    const p = openProtocol(${JSON.stringify(path)}, { busyTimeoutMs: 8000 })
    let got = null, code = null
    try { const m = p.dequeue('race'); got = m && Buffer.from(m.body).toString() } catch (e) { code = e.code }
    p.close()
    console.log(JSON.stringify({ got, code }))
  `
  const startAt = String(Date.now() + 700)
  const results = [0, 1, 2, 3].map(() => runNode(racer, { env: { START_AT: startAt } })).map(r => JSON.parse(r.stdout))
  const winners = results.filter(r => r.got === 'only-one')
  const nulls = results.filter(r => r.got === null && r.code === null)
  check(winners.length === 1, `exactly one consumer committed the head (won=${winners.length})`)
  check(nulls.length === 3, `the losers saw an empty queue, not an error (null=${nulls.length})`)
  check(results.every(r => r.code === null || r.code === 'PROTOCOL_DATABASE_BUSY'),
    'any contention surfaces as a distinct loud busy code, never as empty state')

  // A consumer killed BEFORE its commit leaves the message pending; killed AFTER, it stays dequeued.
  const crashPath = db('crash')
  runNode(`${preamble}
    const p = openProtocol(${JSON.stringify(crashPath)})
    p.initialize('crash'); p.enqueue('crash', { kind: 'c.v1', body: Buffer.from('X') }); p.close()
  `)
  const preCommit = runNode(`${preamble}
    const p = openProtocol(${JSON.stringify(crashPath)})
    // die INSIDE the write transaction, after the row is staged and before COMMIT
    try { p.withTransaction(tx => { tx.exec("UPDATE protocol_messages SET dequeued_at_ms=1 WHERE target_session_id='crash'"); process.kill(process.pid, 'SIGKILL') }) } catch {}
  `, { expectFail: true })
  const afterPreCommit = runNode(`${preamble}
    const p = openProtocol(${JSON.stringify(crashPath)})
    console.log(JSON.stringify({ pending: p.listPending('crash').length }))
    p.close()
  `)
  check(JSON.parse(afterPreCommit.stdout).pending === 1, 'a process killed before commit leaves the message pending')

  const postCommit = runNode(`${preamble}
    const p = openProtocol(${JSON.stringify(crashPath)})
    const m = p.dequeue('crash')
    console.log(JSON.stringify({ took: Buffer.from(m.body).toString() }))
    process.kill(process.pid, 'SIGKILL')
  `, { expectFail: true })
  check(postCommit.stdout.includes('took'), 'the consumer committed its dequeue before dying')
  const afterPostCommit = runNode(`${preamble}
    const p = openProtocol(${JSON.stringify(crashPath)})
    const history = p.readMessages('crash')
    console.log(JSON.stringify({ pending: p.listPending('crash').length, next: p.dequeue('crash'), dequeued: history[0].dequeuedAtMs !== null }))
    p.close()
  `)
  const post = JSON.parse(afterPostCommit.stdout)
  check(post.pending === 0 && post.next === null && post.dequeued,
    'a process killed after commit never makes the message reappear')
}

// ---------------------------------------------------------------- 5. same-database-composition-needs-no-outbox
say('')
say('# scenario same-database-composition-needs-no-outbox')
{
  const path = db('composition')
  // The scenario asks for a FIXTURE-OWNED extension table, so the fixture owns one directly. The real
  // topology package is exercised below as the M1 composition proof; the scenario itself must not
  // depend on it, or it would stop measuring the protocol's own capability.
  const run = runNode(`${preamble}
    const p = openProtocol(${JSON.stringify(path)})
    p.initialize('target')
    p.withTransaction(tx => tx.exec('CREATE TABLE fixture_rows (id INTEGER PRIMARY KEY, note TEXT NOT NULL) STRICT'))
    const counts = () => p.withTransaction(tx => ({
      rows: tx.query('SELECT count(*) AS c FROM fixture_rows')[0].c,
      messages: tx.query('SELECT count(*) AS c FROM protocol_messages')[0].c,
    }))
    // zero, one, then several notifications beside one extension mutation
    p.withTransaction(tx => { tx.exec("INSERT INTO fixture_rows(note) VALUES('zero')") })
    const afterZero = counts()
    p.withTransaction(tx => { tx.exec("INSERT INTO fixture_rows(note) VALUES('one')"); tx.enqueue('target', { kind: 'n.v1', body: Buffer.from('1') }) })
    const afterOne = counts()
    p.withTransaction(tx => {
      tx.exec("INSERT INTO fixture_rows(note) VALUES('several')")
      for (const n of ['a', 'b', 'c']) tx.enqueue('target', { kind: 'n.v1', body: Buffer.from(n) })
    })
    const afterSeveral = counts()
    // roll back AFTER the extension mutation and BEFORE commit
    let rolledBack = null
    try {
      p.withTransaction(tx => {
        tx.exec("INSERT INTO fixture_rows(note) VALUES('rolled-back')")
        tx.enqueue('target', { kind: 'n.v1', body: Buffer.from('rolled-back') })
        throw new Error('fixture aborts before commit')
      })
    } catch (e) { rolledBack = e.message }
    const afterRollback = counts()
    const surface = Object.keys(await import(protocolEntry)).sort()
    console.log(JSON.stringify({ afterZero, afterOne, afterSeveral, rolledBack, afterRollback, surface }))
    p.close()
  `)
  const r = JSON.parse(run.stdout)
  check(r.afterZero.rows === 1 && r.afterZero.messages === 0, 'an extension mutation with zero notifications commits alone')
  check(r.afterOne.rows === 2 && r.afterOne.messages === 1, 'one notification commits with its mutation')
  check(r.afterSeveral.rows === 3 && r.afterSeveral.messages === 4, 'several notifications commit with one mutation')
  check(r.rolledBack === 'fixture aborts before commit', 'the fixture aborted after the mutation and before commit')
  check(r.afterRollback.rows === 3 && r.afterRollback.messages === 4,
    'extension state and messages disappeared together — nothing partial survived')
  const forbidden = r.surface.filter(name => /outbox|dispatch|replay|connection|database|raw|handle/i.test(name))
  check(forbidden.length === 0, `the public surface exposes no outbox, dispatcher, or raw connection (${r.surface.join(',')})`)
}

// ---------------------------------------------------------------- 6. explicit-path-opaque-data-and-lost-wake
say('')
say('# scenario explicit-path-opaque-data-and-lost-wake')
{
  const path = db('opaque')
  const configRoot = join(root, 'adopter-config'); mkdirSync(configRoot)
  writeFileSync(join(configRoot, 'session.json'), JSON.stringify({ databasePath: join(dbRoot, 'DECOY-never-open.sqlite') }))
  // cwd, HOME, adopter config and the database are four different places on purpose.
  const opaqueBody = '[0,1,2,255,128,10,13,0]'
  const producer = runNode(`${preamble}
    let relative = null
    try { openProtocol('relative.sqlite') } catch (e) { relative = e.code }
    let fromConfig = null
    try { openProtocol(${JSON.stringify(join(configRoot, 'session.json'))}) } catch (e) { fromConfig = e.code }
    const p = openProtocol(${JSON.stringify(path)})
    p.initialize('opaque')
    const body = Uint8Array.from(${opaqueBody})
    const headers = { 'x.trace': 'a b\\tc', 'z-last': '', 'A_FIRST': '1' }
    const written = p.enqueue('opaque', { kind: 'zswarm.unknown-kind.v9', body, headers })
    console.log(JSON.stringify({ relative, cwd: process.cwd(), home: process.env.HOME, written: written.messageId }))
    p.close()   // exits without emitting any wake hint of any kind
  `, { cwd: elsewhere, env: { SPEX_SESSION_CONFIG: join(configRoot, 'session.json') } })
  const p1 = JSON.parse(producer.stdout)
  check(p1.relative === 'PROTOCOL_PATH_NOT_ABSOLUTE', 'a relative path is refused rather than resolved from cwd')
  check(p1.cwd === elsewhere && p1.home === fakeHome, 'the producer ran with a cwd and HOME distinct from the database')
  check(!existsSync(join(dbRoot, 'DECOY-never-open.sqlite')), 'no adopter config or environment selected storage for the protocol')

  // A DIFFERENT process, started later, with every wake hint lost by construction (there was none).
  const consumerRun = runNode(`${preamble}
    const p = openProtocol(${JSON.stringify(path)})
    const pending = p.listPending('opaque')
    const m = pending[0]
    console.log(JSON.stringify({
      count: pending.length,
      sameMessage: m.messageId,
      body: Array.from(m.body),
      headers: m.headers,
      kind: m.kind,
    }))
    p.close()
  `, { cwd: fakeHome })
  const p2 = JSON.parse(consumerRun.stdout)
  check(p2.count === 1 && p2.sameMessage === p1.written, 'a later process discovers the pending row from SQLite alone')
  check(JSON.stringify(p2.body) === opaqueBody, 'opaque body bytes round-trip exactly, NUL and high bytes included')
  check(p2.headers['x.trace'] === 'a b\tc' && p2.headers['z-last'] === '' && p2.headers.A_FIRST === '1',
    'headers round-trip exactly, including an empty value and a tab')
  check(p2.kind === 'zswarm.unknown-kind.v9', 'an unknown kind is stored and returned without product interpretation')
}

// ---------------------------------------------------------------- M1 composition proof (topology, beyond the six)
if (PACKAGES.includes('session-topology')) {
  say('')
  say('# M1 composition — topology mutation and its required enqueues, one transaction')
  const path = db('topology')
  const run = runNode(`${preamble}
    const topologyEntry = require.resolve('@spexcode/session-topology')
    if (!topologyEntry.startsWith(${JSON.stringify(join(consumer, 'node_modules'))})) throw new Error('topology escaped the consumer')
    const { openTopology, TopologyError } = await import(topologyEntry)
    const p = openProtocol(${JSON.stringify(path)})
    const t = openTopology(p)
    for (const id of ['parent_a', 'child_x', 'watcher_w', 'parent_b']) p.initialize(id)
    p.withTransaction(tx => {
      t.attach(tx, 'parent_a', 'child_x', 'parent')
      t.subscribe(tx, 'watcher_w', 'child_x', 'watch.status')
      for (const r of t.recipients('child_x', tx)) tx.enqueue(r, { kind: 'n.v1', body: Buffer.from('moved') })
    })
    const committed = { recipients: t.recipients('child_x'), parent: p.listPending('parent_a').length, watcher: p.listPending('watcher_w').length }
    let identity = null
    try { p.withTransaction(tx => { t.attach(tx, 'parent_b', 'child_x', 'other'); tx.enqueue('parent_b', { kind: 'n.v1', body: Buffer.from('vanishes') }); throw new TopologyError('TOPOLOGY_EDGE_EXISTS', 'read-only in adopter policy') }) }
    catch (e) { identity = { name: e.name, code: e.code, isTopology: e instanceof TopologyError } }
    const after = { edges: t.parents('child_x').length, parentB: p.listPending('parent_b').length }
    console.log(JSON.stringify({ committed, identity, after, entry: topologyEntry }))
    p.close()
  `)
  const r = JSON.parse(run.stdout)
  check(r.entry.includes('node_modules/@spexcode/session-topology'), 'topology resolved from the consumer too')
  check(JSON.stringify(r.committed.recipients) === '["parent_a","watcher_w"]', 'attach and subscribe feed one recipient set')
  check(r.committed.parent === 1 && r.committed.watcher === 1, 'one transaction carried the mutation and every required enqueue')
  check(r.identity.isTopology && r.identity.code === 'TOPOLOGY_EDGE_EXISTS',
    'an adopter refusal keeps its identity across the transaction boundary, despite SQLite-like wording')
  check(r.after.edges === 2 && r.after.parentB === 0, 'the aborted transaction left neither the edge nor the message')
}

say('')
say(`m1-conformance: ${lines.filter(l => l.startsWith('ok  ')).length} assertions passed`)
const transcript = join(root, 'transcript.txt')
writeFileSync(transcript, lines.join('\n') + '\n')
say(`transcript ${transcript}`)
if (!keep) { /* the consumer is kept for inspection only when asked */ }
