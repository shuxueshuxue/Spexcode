import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const userHome = resolve(join(homedir(), '.spexcode'))

function assertNotUserHome(home) {
  if (resolve(home) === userHome) {
    throw new Error(`Refusing to run tests with SPEXCODE_HOME pointed at the user home: ${userHome}`)
  }
}

if (process.env.SPEXCODE_HOME) assertNotUserHome(process.env.SPEXCODE_HOME)

const testHome = mkdtempSync(join(tmpdir(), 'spexcode-test-home-'))
process.env.SPEXCODE_HOME = testHome
assertNotUserHome(testHome)

process.once('exit', () => {
  try {
    rmSync(testHome, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 })
  } catch (error) {
    console.error(`Failed to remove test SPEXCODE_HOME ${testHome}:`, error)
    process.exitCode = 1
  }
})
