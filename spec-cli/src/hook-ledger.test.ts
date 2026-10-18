import { fixtureTempDir } from '../test/fixtures/temp-dir.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { readLedger } from './hook-ledger.js'

const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const dispatch = join(repo, 'spec-cli', 'hooks', 'dispatch.sh')

// a project that dispatches into its own store, so the ledger under test is only what this test wrote
function fixture(handlers: Array<{ event: string; name: string; body: string; block?: boolean }>) {
  const dir = fixtureTempDir('spex-ledger-')
  const home = join(dir, 'home')
  execFileSync('git', ['init', '-q'], { cwd: dir })
  const manifest = join(dir, 'hooks-manifest')
  let lines = ''
  for (const h of handlers) {
    mkdirSync(join(dir, 'hooks', h.name), { recursive: true })
    writeFileSync(join(dir, 'hooks', h.name, `${h.name}.sh`), h.body)
    lines += `${h.event}\t10\t${h.block ? 'true' : 'false'}\thooks/${h.name}/${h.name}.sh\n`
  }
  writeFileSync(manifest, lines)
  const fire = (event: string, extraEnv: Record<string, string> = {}) => spawnSync('bash', [dispatch, 'claude', event], {
    cwd: dir,
    env: { ...process.env, SPEXCODE_HOME: home, SPEX_HOOK_MANIFEST: manifest, ...extraEnv },
    input: JSON.stringify({ session_id: 'sess-1', hook_event_name: event }),
    encoding: 'utf8',
  })
  const read = () => {
    const prior = process.env.SPEXCODE_HOME
    process.env.SPEXCODE_HOME = home
    try { return readLedger(dir) } finally { if (prior === undefined) delete process.env.SPEXCODE_HOME; else process.env.SPEXCODE_HOME = prior }
  }
  const ledgerDir = () => join(home, 'projects', join(dir).replace(/[/.]/g, '-'), 'hook-ledger')
  return { dir, home, fire, read, ledgerDir }
}

test('every dispatched handler leaves a start and a done line carrying its outcome', () => {
  const f = fixture([{ event: 'PostToolUse', name: 'quiet', body: '#!/usr/bin/env bash\nexit 0\n' }])
  assert.equal(f.fire('PostToolUse').status, 0)
  const file = join(f.ledgerDir(), readdirSync(f.ledgerDir())[0])
  const rows = readFileSync(file, 'utf8').trim().split('\n').map((line) => line.split('\t'))
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((r) => r[1]), ['start', 'done'])
  const [, , session, harness, event, hook, order, code, block] = rows[1]
  assert.deepEqual({ session, harness, event, hook, order, code, block }, {
    session: 'sess-1', harness: 'claude', event: 'PostToolUse', hook: 'quiet', order: '10', code: '0', block: '0',
  })
})

test('the reader counts runs, refusals with their reason, failures, and a median — never a killed run', () => {
  const f = fixture([
    { event: 'Stop', name: 'gate', block: true, body: '#!/usr/bin/env bash\nprintf \'{"decision":"block","reason":"branch is dirty"}\'\n' },
    { event: 'PostToolUse', name: 'noisy', body: '#!/usr/bin/env bash\nexit 3\n' },
  ])
  assert.equal(f.fire('Stop').status, 2)
  f.fire('PostToolUse')
  f.fire('PostToolUse')
  // a run the harness killed: a start with no done, which must not become a run
  const dir = f.ledgerDir()
  const file = join(dir, readdirSync(dir)[0])
  writeFileSync(file, `${readFileSync(file, 'utf8')}1789000000000\tstart\tsess-1\tclaude\tStop\tgate\t10\t\t\t\t\n`)

  const view = f.read()
  assert.equal(view.available, true)
  assert.equal(view.runs, 3)
  assert.equal(view.days, 1)
  assert.equal(view.byHook.gate.runs, 1)
  assert.equal(view.byHook.gate.refusals, 1)
  assert.equal(view.byHook.gate.unfinished, 1)
  assert.equal(view.byHook.gate.lastRefusal?.reason, 'branch is dirty')
  assert.equal(view.byHook.noisy.runs, 2)
  assert.equal(view.byHook.noisy.failures, 2)
  assert.equal(view.byHook.noisy.refusals, 0)
  assert.equal(typeof view.byHook.noisy.medianMs, 'number')
})

test('a hook that never ran is absent, so the page can say so without inventing a zero', () => {
  const f = fixture([{ event: 'PostToolUse', name: 'ran', body: '#!/usr/bin/env bash\nexit 0\n' }])
  f.fire('PostToolUse')
  const view = f.read()
  assert.ok(view.byHook.ran)
  assert.equal(view.byHook['never-bound'], undefined)
})

test('an empty store answers unavailable rather than an empty count', () => {
  const f = fixture([{ event: 'PostToolUse', name: 'ran', body: '#!/usr/bin/env bash\nexit 0\n' }])
  const view = f.read()
  assert.deepEqual(view, { available: false, sinceDay: null, days: 0, runs: 0, byHook: {} })
})

test('SPEX_HOOK_LEDGER=off dispatches normally and writes nothing', () => {
  const f = fixture([{ event: 'PostToolUse', name: 'ran', body: '#!/usr/bin/env bash\nexit 0\n' }])
  assert.equal(f.fire('PostToolUse', { SPEX_HOOK_LEDGER: 'off' }).status, 0)
  assert.equal(existsSync(f.ledgerDir()), false)
})

test('a ledger that cannot be written is named on stderr and never changes the verdict', () => {
  const f = fixture([{ event: 'PostToolUse', name: 'ran', body: '#!/usr/bin/env bash\nexit 0\n' }])
  mkdirSync(f.home, { recursive: true })
  writeFileSync(join(f.home, 'projects'), 'not a directory\n')   // the store's own parent is a FILE: mkdir -p must fail
  const r = f.fire('PostToolUse')
  assert.equal(r.status, 0)
  assert.match(r.stderr, /hook ledger unwritable/)
})
