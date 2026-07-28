import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))

function sessionHelp(verb?: string) {
  const args = verb ? ['session', verb, '--help'] : ['session']
  return spawnSync('tsx', [cli, ...args], { cwd: pkgRoot, encoding: 'utf8' })
}

test('session noun-verb help projects the exact verb from the shared drawer definition', () => {
  const cases = [
    { verb: 'send', usage: 'Usage: spex session send <SEL> "<msg>"', behavior: /UNSTABLE LAST RESORT|LAST RESORT:[\s\S]*UNSTABLE/ },
    { verb: 'wait', usage: 'Usage: spex session wait <SEL>', behavior: /EDGE-TRIGGERED[\s\S]*non-actionable status into an actionable one/ },
    { verb: 'new', usage: 'Usage: spex session new "<prompt>"', behavior: /--prompt-file[\s\S]*successful receipt/ },
  ]
  const outputs = cases.map(({ verb, usage, behavior }) => {
    const result = sessionHelp(verb)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    assert.match(result.stdout, new RegExp(usage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(result.stdout, behavior)
    assert.doesNotMatch(result.stdout, /Manager verbs \(dispatch, monitor, land\)/)
    assert.match(result.stdout, /map: spex help · skills: spex guide/)
    return result.stdout
  })
  assert.equal(new Set(outputs).size, cases.length)
})

test('bare session keeps the complete compatible drawer', () => {
  const result = sessionHelp()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.match(result.stdout, /Manager verbs \(dispatch, monitor, land\)/)
  assert.match(result.stdout, /spex session new "<prompt>"/)
  assert.match(result.stdout, /spex session wait <SEL>/)
  assert.match(result.stdout, /spex session send <SEL> "<msg>"/)
  assert.match(result.stdout, /spex session unarchive <SEL>/)
})
