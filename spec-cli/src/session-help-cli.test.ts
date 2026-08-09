import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
    { verb: 'done', usage: 'Usage: spex session done --propose merge|nothing|close', behavior: /merge.*review[\s\S]*ONLY declaration.*clickable merge[\s\S]*nothing.*trap[\s\S]*close.*close-pending/ },
    { verb: 'park', usage: 'Usage: spex session park --note <what-you-await>', behavior: /parked[\s\S]*managed watch delivery[\s\S]*background task[\s\S]*asking/ },
    { verb: 'ask', usage: 'Usage: spex session ask --note <your-question>', behavior: /asking[\s\S]*human reply[\s\S]*parked/ },
    { verb: 'quarantine', usage: 'Usage: spex session quarantine <ID> --adapter <harness> [--thread <native-id>] --tmux <id> --worktree <absent-path> --branch <absent-branch> [--restore]', behavior: /--thread is an adapter-native conversation id, never the SpexCode session id; omit it for Claude/ },
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

test('done nothing traps before it can write a terminal state', () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-nothing-trap-'))
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const project = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: pkgRoot, encoding: 'utf8' }).trim())
  const record = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', id, 'session.json')
  try {
    mkdirSync(dirname(record), { recursive: true })
    writeFileSync(record, `${JSON.stringify({
      session_id: id, governed: true, worktree_path: project, branch: 'node/nothing-trap', node: null,
      title: 'nothing trap', name: '', parent: null, status: 'active', proposal: null, merges: 0, note: null,
      sortkey: null, createdAt: Date.now(), harness: 'claude', harness_session_id: '', stopped: false,
      archived: false, launcher: 'fixture', launch_cmd: 'true',
    }, null, 2)}\n`)
    const before = readFileSync(record, 'utf8')
    for (const args of [[], ['--propose', 'nothing']]) {
      const result = spawnSync('tsx', [cli, 'session', 'done', ...args], {
        cwd: pkgRoot, encoding: 'utf8', env: { ...process.env, SPEXCODE_HOME: home, SPEXCODE_SESSION_ID: id },
      })
      assert.equal(result.status, 2)
      assert.equal(result.stdout, '')
      assert.match(result.stderr, /done --propose nothing.*trap: no state was recorded/)
      assert.match(result.stderr, /merge.*close.*ask.*park/)
      assert.equal(readFileSync(record, 'utf8'), before)
    }
  } finally { rmSync(home, { recursive: true, force: true }) }
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
  assert.match(stopGate, /done --propose nothing.*TRAP: records no state/)
  assert.match(stopGate, /done --propose close.*CLOSE-PENDING.*not merge/)
  assert.match(stopGate, /done --propose close.*task finished, work landed.*worktree no longer needed, and no posted artifact awaits inspection: propose human close/)
  assert.match(stopGate, /ask --note.*human.*ASKING/)
  assert.match(stopGate, /posted file\/web artifact still needs human inspection.*session ask/)
  assert.match(stopGate, /park --note.*real wake-up.*named next action.*terminal children is not a wake-up.*PARKED/)
  assert.match(stopGate, /done --propose merge \(review; ONLY clickable merge\).*close \(close-pending; no posted artifact waiting\).*park \(parked; real wake-up \+ next action\).*ask \(asking; human reply or posted artifact review\).*nothing.*trap/)
  assert.match(stopGate, /auto: stopped without declaring — choose merge, close, ask, or park; done --propose nothing records no state/)
})
