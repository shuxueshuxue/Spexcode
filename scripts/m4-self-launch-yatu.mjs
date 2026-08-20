// M4 synced self-launch YATU.
//
// The product loop a self-launching user actually gets: a project whose harness artifacts were written by
// the real `spex materialize`, a listener reached through the real `dispatch.sh`, and an adopter CLI
// installed from a packed tarball. No backend, no governed record, no resident process, no wake hint.
//
// It measures the POSITIVE loop on the final integration head. The negative half — every legacy facility
// absent, corrupt, or read-only — belongs to the sabotage gate and is not restated here.
//
// usage: node scripts/m4-self-launch-yatu.mjs
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const lines = []
const say = (t) => { lines.push(t); console.log(t) }
const fail = (m) => { throw new Error(m) }
const check = (cond, label) => { say(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) fail(label) }

const root = mkdtempSync(join(tmpdir(), 'm4-yatu-'))
const home = join(root, 'home'); mkdirSync(home)
const proj = join(root, 'project'); mkdirSync(proj)
const dbDir = join(root, 'state'); mkdirSync(dbDir)
const dbPath = join(dbDir, 'sessions.sqlite')
say(`node ${process.version}`)
say(`fixture ${root}`)

// Everything the run touches must live under the fixture: SPEXCODE_HOME, the project, and the database.
const baseEnv = { ...process.env, SPEXCODE_HOME: join(home, '.spexcode'), HOME: home, TMPDIR: join(root, 'tmp') }
mkdirSync(baseEnv.TMPDIR, { recursive: true })

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: opts.cwd ?? proj, env: { ...baseEnv, ...(opts.env ?? {}) }, input: opts.input })
  if (!opts.allowFail && r.status !== 0) fail(`${cmd} ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout}`)
  return r
}

// ---------------------------------------------------------------- a real project, real materialize
run('git', ['init', '-q', proj], { cwd: root })
run('git', ['-C', proj, 'config', 'user.email', 'yatu@example.test'], { cwd: root })
run('git', ['-C', proj, 'config', 'user.name', 'YATU'], { cwd: root })
writeFileSync(join(proj, 'README.md'), '# m4 yatu fixture\n')
run('git', ['-C', proj, 'add', '-A'], { cwd: root })
run('git', ['-C', proj, 'commit', '-qm', 'fixture'], { cwd: root })

const spex = join(repoRoot, 'bin', 'spex.mjs')
const init = run(process.execPath, [spex, 'init', '--harness', 'claude'])
say(`init exit=${init.status}`)
const materialize = run(process.execPath, [spex, 'materialize'])
say(`materialize exit=${materialize.status}`)

// The listener must be in the manifest the shell dispatcher actually reads — not merely present in the tree.
const encode = (p) => p.replace(/[/.]/g, '-')
const runtimeRoot = join(baseEnv.SPEXCODE_HOME, 'projects', encode(dirname(join(proj, '.git'))))
const treeSlot = join(runtimeRoot, 'trees', encode(proj))
const manifestPath = join(treeSlot, 'hooks-manifest')
check(existsSync(manifestPath), `the real materialize wrote a manifest at ${manifestPath}`)
const manifest = readFileSync(manifestPath, 'utf8')
check(/session-listen/.test(manifest), 'the listener is bound in the manifest the dispatcher reads')
const bound = manifest.split('\n').filter((l) => l.includes('session-listen')).map((l) => l.split('\t')[0])
say(`listener events: ${bound.join(', ')}`)

// ---------------------------------------------------------------- the adopter, installed from a tarball
const npm = (args, cwd) => {
  const r = spawnSync('npm', args, { cwd, encoding: 'utf8', env: { ...baseEnv, npm_config_audit: 'false', npm_config_fund: 'false' } })
  if (r.status !== 0) fail(`npm ${args.join(' ')} failed: ${r.stderr || r.stdout}`)
  return r.stdout
}
const tarballs = []
for (const name of ['session-protocol', 'session-selflaunch']) {
  const dir = join(repoRoot, 'packages', name)
  npm(['run', 'build'], dir)
  const packed = JSON.parse(npm(['pack', '--json', '--pack-destination', root], dir))[0]
  tarballs.push(join(root, packed.filename))
  say(`tarball ${packed.name} shasum=${packed.shasum}`)
}
const consumer = join(root, 'consumer'); mkdirSync(consumer)
writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'm4-consumer', private: true, version: '0.0.0' }))
npm(['install', '--no-audit', '--no-fund', ...tarballs], consumer)
const cli = join(consumer, 'node_modules', '.bin', 'spex-session')
check(existsSync(cli), 'the adopter CLI resolves from the consumer it was installed into')

const adopterEnv = { SPEX_SESSION_DATABASE_PATH: dbPath, SPEX_SESSION_CLI: cli }

// ---------------------------------------------------------------- the real hook path, no backend
const dispatch = join(repoRoot, 'spec-cli', 'hooks', 'dispatch.sh')
const fire = (event, sessionId) => run('bash', [dispatch, 'claude', event], {
  env: { ...adopterEnv, SPEX: `${process.execPath} ${spex}`, CLAUDE_PROJECT_DIR: proj },
  input: JSON.stringify({ session_id: sessionId, hook_event_name: event, cwd: proj }),
  allowFail: true,
})

const backends = spawnSync('bash', ['-c', `ss -tlnH 2>/dev/null | wc -l`], { encoding: 'utf8' })
const sid = 'selflaunch_yatu_1'

const start = fire('SessionStart', sid)
check(start.status === 0, `SessionStart through the real dispatcher exits 0 (stderr: ${start.stderr.trim()})`)
const address = run(cli, ['initialize', '--session-id', sid], { env: adopterEnv })
check(JSON.parse(address.stdout).sessionId === sid, 'the address exists and re-initialize is idempotent')

// A producer with no backend and no relationship to the harness process.
const produced = run(cli, ['enqueue', '--session-id', sid, '--kind', 'note.v1', '--body', 'a message that outlives its producer'], { env: adopterEnv })
const messageId = JSON.parse(produced.stdout).messageId
say(`producer enqueued ${messageId} and exited`)

// Nothing is running between producing and consuming: no daemon, no observer, no wake hint.
const psAfter = spawnSync('bash', ['-c', `ps -eo args | grep -c "[s]pex-session" || true`], { encoding: 'utf8' }).stdout.trim()
check(psAfter === '0', `no resident adopter process exists between produce and consume (found ${psAfter})`)

const delivered = fire('UserPromptSubmit', sid)
check(delivered.status === 0, `UserPromptSubmit exits 0 (stderr: ${delivered.stderr.trim()})`)
const payload = JSON.parse(delivered.stdout)
check(payload.hookSpecificOutput?.additionalContext === 'a message that outlives its producer',
  `the harness input seam received the exact body: ${JSON.stringify(payload.hookSpecificOutput?.additionalContext)}`)

const pending = JSON.parse(run(cli, ['pending', '--session-id', sid], { env: adopterEnv }).stdout)
check(pending.length === 0, 'the message is no longer pending — at-most-once delivery committed')
const again = fire('UserPromptSubmit', sid)
check(again.status === 0 && again.stdout.trim() === '', 'an empty queue emits nothing and is a successful no-op')

// ---------------------------------------------------------------- the loop needs no governed record
const sessionsDir = join(runtimeRoot, 'sessions', sid)
check(!existsSync(join(sessionsDir, 'session.json')),
  'the whole loop ran without a governed session record ever existing')

say('')
say(`m4-self-launch-yatu: ${lines.filter((l) => l.startsWith('ok  ')).length} assertions passed`)
const transcript = join(root, 'transcript.txt')
writeFileSync(transcript, lines.join('\n') + '\n')
say(`transcript ${transcript}`)
