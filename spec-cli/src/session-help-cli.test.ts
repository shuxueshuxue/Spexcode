import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const stopGate = readFileSync(join(pkgRoot, '..', '.spec', 'spexcode', '.plugins', 'core', 'stop-gate', 'stop-gate.sh'), 'utf8')

function sessionHelp(verb?: string) {
  const args = verb ? ['session', verb, '--help'] : ['session']
  return spawnSync('tsx', [cli, ...args], { cwd: pkgRoot, encoding: 'utf8' })
}

test('session noun-verb help projects the exact verb from the shared drawer definition', () => {
  const cases = [
    { verb: 'send', usage: 'Usage: spex session send <SEL> "<msg>"', behavior: /LAST RESORT:[\s\S]*UNSTABLE[\s\S]*SEL = session id[\s\S]*PROJECT-BOUND/ },
    { verb: 'wait', usage: 'Usage: spex session wait [SEL…]', behavior: /EDGE-TRIGGERED[\s\S]*non-actionable\s+status into an actionable one[\s\S]*SEL = session id/ },
    { verb: 'new', usage: 'Usage: spex session new "<prompt>"', behavior: /--prompt-file[\s\S]*successful receipt/ },
    { verb: 'done', usage: 'Usage: spex session done --propose merge|nothing|close', behavior: /merge.*review[\s\S]*ONLY declaration.*clickable merge[\s\S]*nothing.*done[\s\S]*close.*close-pending/ },
    { verb: 'park', usage: 'Usage: spex session park --note <what-you-await>', behavior: /parked[\s\S]*background task[\s\S]*asking/ },
    { verb: 'ask', usage: 'Usage: spex session ask --note <your-question>', behavior: /asking[\s\S]*human reply[\s\S]*parked/ },
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
  assert.doesNotMatch(outputs.join('\n'), /USE IT|Background one wait per worker|Give it ONLY its task|don't hand-run git|must NEVER run it/)
})

test('bare session keeps the complete compatible drawer', () => {
  const result = sessionHelp()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.match(result.stdout, /Manager verbs \(dispatch, monitor, land\)/)
  assert.match(result.stdout, /spex session new "<prompt>"/)
  assert.match(result.stdout, /spex session wait \[SEL…\]/)
  assert.match(result.stdout, /spex session send <SEL> "<msg>"/)
  assert.match(result.stdout, /spex session unarchive <SEL>/)
})

test('Stop teaching names every declaration face without changing the gate', () => {
  assert.match(stopGate, /done --propose merge.*REVIEW.*ONLY proposal.*clickable merge/)
  assert.match(stopGate, /done --propose nothing.*DONE.*never a merge/)
  assert.match(stopGate, /done --propose close.*CLOSE-PENDING.*not merge/)
  assert.match(stopGate, /ask --note.*ASKING.*human/)
  assert.match(stopGate, /park --note.*BACKGROUND TASK.*PARKED/)
  assert.match(stopGate, /done --propose merge \(review; ONLY clickable merge\).*nothing \(done; no merge\).*close \(close-pending\).*park \(parked; real background wake-up\).*ask \(asking; human reply\)/)
})
