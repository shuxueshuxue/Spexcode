import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const userHome = resolve(process.env.SPEXCODE_TEST_USER_HOME || join(homedir(), '.spexcode'))
const inheritedTestHome = process.env.SPEXCODE_TEST_HOME
process.env.SPEXCODE_TEST_USER_HOME = userHome

function assertNotUserHome(home) {
  if (resolve(home) === userHome) {
    throw new Error(`Refusing to run tests with SPEXCODE_HOME pointed at the user home: ${userHome}`)
  }
}

const configuredHome = process.env.SPEXCODE_HOME
if (configuredHome) assertNotUserHome(configuredHome)

const inheritedDefault = configuredHome && inheritedTestHome && resolve(configuredHome) === resolve(inheritedTestHome)
const testWorker = process.execArgv.includes('--test')
if (!configuredHome || (testWorker && inheritedDefault)) {
  const testHome = mkdtempSync(join(tmpdir(), 'spexcode-test-home-'))
  process.env.SPEXCODE_HOME = testHome
  process.env.SPEXCODE_TEST_HOME = testHome
  assertNotUserHome(testHome)

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
