import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const userHome = resolve(process.env.SPEXCODE_TEST_USER_HOME || join(homedir(), '.spexcode'))
const inheritedTestHome = process.env.SPEXCODE_TEST_HOME
process.env.SPEXCODE_TEST_USER_HOME = userHome
// Codex keeps project trust in the user's GLOBAL ~/.codex/config.toml, and the codex adapter writes there on
// every materialize. That file is a second persistent user store, so it gets the same redirect as ~/.spexcode.
const userCodexHome = resolve(process.env.SPEXCODE_TEST_USER_CODEX_HOME || join(homedir(), '.codex'))
const inheritedTestCodexHome = process.env.SPEXCODE_TEST_CODEX_HOME
process.env.SPEXCODE_TEST_USER_CODEX_HOME = userCodexHome

function assertNotUserHome(home) {
  if (resolve(home) === userHome) {
    throw new Error(`Refusing to run tests with SPEXCODE_HOME pointed at the user home: ${userHome}`)
  }
}

const configuredHome = process.env.SPEXCODE_HOME
if (configuredHome) assertNotUserHome(configuredHome)
const configuredCodexHome = process.env.CODEX_HOME
if (configuredCodexHome && resolve(configuredCodexHome) === userCodexHome) {
  throw new Error(`Refusing to run tests with CODEX_HOME pointed at the user codex home: ${userCodexHome}`)
}

const inheritedDefault = configuredHome && inheritedTestHome && resolve(configuredHome) === resolve(inheritedTestHome)
const testWorker = process.execArgv.includes('--test')
if (!configuredHome || (testWorker && inheritedDefault)) {
  const testHome = mkdtempSync(join(tmpdir(), 'spexcode-test-home-'))
  process.env.SPEXCODE_HOME = testHome
  process.env.SPEXCODE_TEST_HOME = testHome
  // A test worker inherits the shell's environment. Pin every session-runtime lookup to the
  // worker's isolated store so a fixture backend can never open the operator's canonical SQLite.
  process.env.SPEX_SESSION_DATABASE_PATH = join(testHome, 'sessions.sqlite')
  delete process.env.SPEX_SESSION_CONFIG
  assertNotUserHome(testHome)
  // An explicit fixture CODEX_HOME keeps control; unset, or inherited from the parent test's disposable home,
  // it moves into this process's own disposable home and dies with it.
  const inheritedDefaultCodexHome = configuredCodexHome && inheritedTestCodexHome && resolve(configuredCodexHome) === resolve(inheritedTestCodexHome)
  if (!configuredCodexHome || inheritedDefaultCodexHome) {
    const codexHome = join(testHome, 'codex-home')
    mkdirSync(codexHome)
    process.env.CODEX_HOME = codexHome
    process.env.SPEXCODE_TEST_CODEX_HOME = codexHome
  }

  process.once('exit', () => {
    try {
      rmSync(testHome, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 })
    } catch (error) {
      console.error(`Failed to remove test SPEXCODE_HOME ${testHome}:`, error)
      process.exitCode = 1
    }
  })
}

const preload = `--import=${import.meta.url}`
if (!process.env.NODE_OPTIONS?.includes(preload)) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} ${preload}`.trim()
}
