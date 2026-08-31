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
import { spawn, spawnSync } from 'node:child_process'
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

const sleepMs = (ms) => { const b = new Int32Array(new SharedArrayBuffer(4)); Atomics.wait(b, 0, 0, ms) }

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

spawnSync('bash', ['-c', `ss -tlnH 2>/dev/null | wc -l`], { encoding: 'utf8' })
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
// Residency is asked about THIS RUN, so it is counted by this run's unique fixture path rather than by the
// adopter's name. Matching the name searches every process on the host: it counts unrelated work that merely
// mentions `spex-session` — measured, 11 false matches from worktree paths on a busy machine — and it would
// equally miss a resident child of ours whose argv spells the adopter differently. The fixture path can only
// appear in argv that this run produced.
// Read /proc directly rather than shelling out: a `ps | grep <fixture>` pipeline carries the fixture path in
// its OWN argv, so it counts itself — measured, it never fell below 2. Our node process does not carry the
// path, so the scan has no self-match to exclude.
const residentCount = () => readdirSync('/proc')
  .filter((entry) => /^\d+$/.test(entry) && entry !== String(process.pid))
  .filter((pid) => {
    try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').some((arg) => arg.includes(root)) }
    catch { return false }          // the process exited between readdir and read; it is not resident
  }).length

// The count has to be able to find something, or a zero from it proves nothing. Hold one process that carries
// the fixture path, confirm it is seen, then reap it and confirm the count falls back to zero.
// The canary must both stay alive and carry the path: `sleep 30 --fixture=<path>` exits instantly on an
// unknown option, which made the probe read 0 and look broken when it was the canary that had died.
const canary = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)', root], { stdio: 'ignore' })
let withCanary = 0
for (let i = 0; i < 100 && withCanary === 0; i++) { withCanary = residentCount(); if (!withCanary) sleepMs(20) }
canary.kill('SIGKILL')
check(withCanary >= 1, `the residency probe can see a process of this run (canary observed ${withCanary})`)

const psAfter = residentCount()
check(psAfter === 0, `no resident adopter process exists between produce and consume (found ${psAfter})`)

const delivered = fire('UserPromptSubmit', sid)
check(delivered.status === 0, `UserPromptSubmit exits 0 (stderr: ${delivered.stderr.trim()})`)
const payload = JSON.parse(delivered.stdout)
check(payload.hookSpecificOutput?.additionalContext === 'a message that outlives its producer',
  `the harness input seam received the exact body: ${JSON.stringify(payload.hookSpecificOutput?.additionalContext)}`)

const pending = JSON.parse(run(cli, ['pending', '--session-id', sid], { env: adopterEnv }).stdout)
check(pending.length === 0, 'the message is no longer pending — at-most-once delivery committed')
const again = fire('UserPromptSubmit', sid)
check(again.status === 0 && again.stdout.trim() === '', 'an empty queue emits nothing and is a successful no-op')

// ---------------------------------------------------------------- a decoder that is present but incapable
// The listener consumes at-most-once and renders afterwards, so every tool it needs to render must be proven
// CAPABLE before the dequeue, not merely present. This vector is the durable form of that guarantee: without
// it the protection lives only in a log of a run that already happened, and nothing fails when it regresses.
//
// The shim is the nastier of the two failure shapes: it ACCEPTS the decode option and exits 0, but passes its
// input through unchanged. An exit-code-only probe accepts it and then delivers base64 text as if it were the
// body; only comparing decoded bytes against a known vector catches it.
{
  const shimDir = join(root, 'copy-through-bin')
  mkdirSync(shimDir, { recursive: true })
  const shim = join(shimDir, 'base64')
  writeFileSync(shim, '#!/bin/sh\nfor a in "$@"; do case "$a" in -d|-D|--decode) cat; exit 0;; esac; done\nexec /usr/bin/base64 "$@"\n')
  spawnSync('chmod', ['+x', shim])

  const doomed = run(cli, ['enqueue', '--session-id', sid, '--kind', 'note.v1', '--body', 'must outlive a broken decoder'], { env: adopterEnv })
  const doomedId = JSON.parse(doomed.stdout).messageId

  const blocked = run('bash', [dispatch, 'claude', 'UserPromptSubmit'], {
    env: { ...adopterEnv, SPEX: `${process.execPath} ${spex}`, CLAUDE_PROJECT_DIR: proj, PATH: `${shimDir}:${process.env.PATH}` },
    input: JSON.stringify({ session_id: sid, hook_event_name: 'UserPromptSubmit', cwd: proj }),
    allowFail: true,
  })
  check(blocked.status === 2, `a present-but-incapable decoder blocks loudly (exit ${blocked.status})`)
  check(blocked.stdout.trim() === '', `it emits no harness input at all (stdout ${JSON.stringify(blocked.stdout)})`)
  check(/capability/i.test(blocked.stderr), `its stderr names the capability and its repair: ${blocked.stderr.trim().slice(0, 90)}`)

  const survived = JSON.parse(run(cli, ['pending', '--session-id', sid], { env: adopterEnv }).stdout)
  check(survived.length === 1 && survived[0].messageId === doomedId,
    `the message is still PENDING after the refusal — it was never consumed (${survived.length} pending)`)

  // Leave the queue as the rest of the run expects: the same message delivers once the decoder is sound.
  const recovered = fire('UserPromptSubmit', sid)
  check(recovered.status === 0 && JSON.parse(recovered.stdout).hookSpecificOutput.additionalContext === 'must outlive a broken decoder',
    'and it delivers intact once a capable decoder is on PATH')
}

// ---------------------------------------------------------------- the loop needs no governed record
const sessionsDir = join(runtimeRoot, 'sessions', sid)
check(!existsSync(join(sessionsDir, 'session.json')),
  'the whole loop ran without a governed session record ever existing')

say('')
say(`m4-self-launch-yatu: ${lines.filter((l) => l.startsWith('ok  ')).length} assertions passed`)
const transcript = join(root, 'transcript.txt')
writeFileSync(transcript, lines.join('\n') + '\n')
say(`transcript ${transcript}`)
