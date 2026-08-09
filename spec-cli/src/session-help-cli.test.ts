import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const stopGatePath = join(pkgRoot, '..', '.spec', 'spexcode', '.plugins', 'core', 'stop-gate', 'stop-gate.sh')
const stopGate = readFileSync(stopGatePath, 'utf8')

function sessionHelp(verb?: string) {
  const args = verb ? ['session', verb, '--help'] : ['session']
  return spawnSync('tsx', [cli, ...args], { cwd: pkgRoot, encoding: 'utf8' })
}

test('session noun-verb help projects the exact verb from the shared drawer definition', () => {
  const cases = [
    { verb: 'send', usage: 'Usage: spex session send <SEL> "<msg>"', behavior: /LAST RESORT:[\s\S]*UNSTABLE[\s\S]*SEL = session id[\s\S]*PROJECT-BOUND/ },
    { verb: 'wait', usage: 'Usage: spex session wait [SEL…]', behavior: /EDGE-TRIGGERED[\s\S]*non-actionable\s+status into an actionable one[\s\S]*SEL = session id/ },
    { verb: 'new', usage: 'Usage: spex session new "<prompt>"', behavior: /--prompt-file[\s\S]*successful receipt/ },
    { verb: 'done', usage: 'Usage: spex session done --propose merge|nothing|close', behavior: /merge.*review[\s\S]*ONLY declaration.*clickable merge[\s\S]*nothing.*trap[\s\S]*close.*close-pending[\s\S]*settled work[\s\S]*no outstanding human decision, follow-up, or inspection/ },
    { verb: 'park', usage: 'Usage: spex session park --note <what-you-await>', behavior: /parked[\s\S]*managed watch delivery[\s\S]*background task[\s\S]*asking/ },
    { verb: 'ask', usage: 'Usage: spex session ask --note <your-question>', behavior: /asking[\s\S]*human reply or direction[\s\S]*answered exploratory question[\s\S]*handoff awaiting follow-up[\s\S]*parked/ },
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
      assert.match(result.stderr, /done --propose nothing.*intended trap: no state was recorded/)
      assert.match(result.stderr, /merge.*not landed in `main`/)
      assert.match(result.stderr, /close.*has landed.*verified.*human decision\/follow-up.*posted artifact/)
      assert.match(result.stderr, /ask.*human input.*direction.*answered exploratory question.*handoff awaiting follow-up.*posted artifact.*inspection/)
      assert.match(result.stderr, /park.*managed delivery.*background job.*terminal children.*wake-up/)
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
  assert.match(stopGate, /done --propose close.*task genuinely settled, work landed.*worktree no longer needed, and no human decision, follow-up, or posted artifact awaits inspection: propose human close/)
  assert.match(stopGate, /ask --note.*answered exploratory question or handoff awaiting their follow-up.*ASKING/)
  assert.match(stopGate, /posted file\/web artifact still needs human inspection.*session ask/)
  assert.match(stopGate, /park --note.*real wake-up.*named next action.*terminal children is not a wake-up.*PARKED/)
  assert.match(stopGate, /done --propose merge \(review; ONLY clickable merge\).*close \(close-pending; settled, no human decision\/follow-up or posted artifact waiting\).*park \(parked; real wake-up \+ next action\).*ask \(asking; human reply\/direction, including exploratory answer or handoff\).*nothing.*trap/)
  assert.match(stopGate, /auto: stopped without declaring — choose merge, close, ask, or park; done --propose nothing records no state/)
})

test('Stop gate teaches exploratory follow-up and handoffs as asking', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-stop-gate-guidance-'))
  const store = join(fixture, 'store')
  const lib = join(fixture, 'harness.sh')
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  try {
    mkdirSync(store, { recursive: true })
    writeFileSync(lib, `hp_session_id() { case "$1" in *'"session_id":"${id}"'*) printf %s '${id}' ;; esac; }\nhp_store_dir() { printf %s "$HOOK_STORE"; }\n`)
    writeFileSync(join(store, 'session.json'), `${JSON.stringify({ governed: true, status: 'active', proposal: null }, null, 2)}\n`)
    const invoke = () => spawnSync('bash', [stopGatePath], {
      cwd: fixture,
      input: `{"session_id":"${id}","stop_hook_active":false}`,
      encoding: 'utf8',
      env: { ...process.env, SPEXCODE_HARNESS_LIB: lib, HOOK_STORE: store },
    })

    const full = invoke()
    assert.equal(full.status, 0, full.stderr)
    const fullReason = JSON.parse(full.stdout).reason as string
    assert.match(fullReason, /task genuinely settled.*no human decision, follow-up, or posted artifact.*CLOSE-PENDING/)
    assert.match(fullReason, /answered exploratory question or handoff awaiting their follow-up.*ASKING/)

    const terse = invoke()
    assert.equal(terse.status, 0, terse.stderr)
    const terseReason = JSON.parse(terse.stdout).reason as string
    assert.match(terseReason, /close-pending; settled, no human decision\/follow-up or posted artifact waiting/)
    assert.match(terseReason, /asking; human reply\/direction, including exploratory answer or handoff/)
    assert.ok(terseReason.length < fullReason.length, 'the compacted-context teaching remains compact')
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})
