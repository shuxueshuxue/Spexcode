// What a shell hook actually pays. Measures the whole process, not just the SQLite call, because
// the driver's open cost only matters relative to the interpreter startup it sits on top of.
//
//   npm install --no-save better-sqlite3
//   node probe-thin-cli.mjs
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'thin-cli-'))
const NODES = {
  'v22.21.0': '/home/jeffry/.nvm/versions/node/v22.21.0/bin/node',
  'v24.15.0': process.execPath,
}
const RUNS = 20

const scripts = {
  bare: 'process.exit(0)',
  'node:sqlite': `
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(process.argv[2])
db.exec('PRAGMA busy_timeout=5000')
db.exec('PRAGMA journal_mode=WAL')
db.exec('CREATE TABLE IF NOT EXISTS t(a INTEGER PRIMARY KEY, v TEXT NOT NULL) STRICT')
db.prepare('INSERT INTO t(v) VALUES(?)').run('hook')
db.close()`,
  'better-sqlite3': `
import Database from 'better-sqlite3'
const db = new Database(process.argv[2])
db.pragma('busy_timeout = 5000')
db.pragma('journal_mode = WAL')
db.exec('CREATE TABLE IF NOT EXISTS t(a INTEGER PRIMARY KEY, v TEXT NOT NULL) STRICT')
db.prepare('INSERT INTO t(v) VALUES(?)').run('hook')
db.close()`,
}

const measure = (nodeBin, script, dbPath) => {
  // The script must live beside the spike's node_modules or better-sqlite3 will not resolve, and
  // "unavailable" would be mistaken for "measured as slow".
  const file = join(process.cwd(), '.thin-cli-probe.mjs')
  writeFileSync(file, script)
  const samples = []
  for (let i = 0; i < RUNS; i++) {
    const t = process.hrtime.bigint()
    const result = spawnSync(nodeBin, [file, dbPath], { encoding: 'utf8', cwd: process.cwd() })
    const ms = Number(process.hrtime.bigint() - t) / 1e6
    if (result.status !== 0) return { error: (result.stderr || '').split('\n').slice(0, 3).join(' ') }
    samples.push(ms)
  }
  samples.sort((a, b) => a - b)
  return { mean: samples.reduce((a, b) => a + b, 0) / samples.length, p50: samples[Math.floor(RUNS / 2)] }
}

console.log(`whole-process cost of one thin-CLI invocation, ${RUNS} runs each\n`)
for (const [label, bin] of Object.entries(NODES)) {
  console.log(`### node ${label}`)
  const bare = measure(bin, scripts.bare, '')
  console.log(`    bare interpreter startup : ${bare.error ?? `${bare.mean.toFixed(1)} ms mean (p50 ${bare.p50.toFixed(1)})`}`)
  for (const driver of ['node:sqlite', 'better-sqlite3']) {
    const dbPath = join(dir, `${label}-${driver.replace(/\W/g, '')}.sqlite`)
    const got = measure(bin, scripts[driver], dbPath)
    if (got.error) { console.log(`    ${driver.padEnd(24)} : UNAVAILABLE (${got.error})`); continue }
    const delta = got.mean - bare.mean
    console.log(`    ${driver.padEnd(24)} : ${got.mean.toFixed(1)} ms mean (p50 ${got.p50.toFixed(1)}), `
      + `+${delta.toFixed(1)} ms over bare = +${((delta / bare.mean) * 100).toFixed(0)}%`)
  }
  console.log()
}
rmSync(dir, { recursive: true, force: true })
rmSync(join(process.cwd(), '.thin-cli-probe.mjs'), { force: true })
