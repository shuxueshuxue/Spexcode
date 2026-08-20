import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dirname, fileURLToPath } from 'node:url'

const run = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
const root = mkdtempSync(join(tmpdir(), 'spex-soft-close-proof-'))
const project = join(root, 'project')
const home = join(root, 'home')
const worktree = join(root, 'worktree')
const id = 'soft-close-proof-000000000000000000000000000000000000'
mkdirSync(project, { recursive: true }); mkdirSync(home)
run(project, ['init', '-q', '-b', 'main'])
run(project, ['config', 'user.name', 'proof']); run(project, ['config', 'user.email', 'proof@example.test'])
writeFileSync(join(project, 'README.md'), 'base\n'); run(project, ['add', '.']); run(project, ['commit', '-qm', 'base'])
const runner = join(project, 'runner.sh')
writeFileSync(runner, '#!/bin/sh\nexec node -e "require(\'net\').createServer().listen(process.env.CLAUDE_BG_RENDEZVOUS_SOCK); setInterval(() => {}, 1000)"\n', { mode: 0o755 })
run(project, ['add', 'runner.sh']); run(project, ['commit', '-qm', 'runner'])
run(project, ['branch', `node/${id}`]); run(project, ['worktree', 'add', '-q', '-B', `node/${id}`, worktree, 'main'])
writeFileSync(join(worktree, 'README.md'), 'dirty tracked\n'); writeFileSync(join(worktree, 'untracked.txt'), 'dirty untracked\n')
const encoded = realpathSync(project).replaceAll('/', '-')
const store = join(home, 'projects', encoded, 'sessions', id)
mkdirSync(store, { recursive: true })
writeFileSync(join(store, 'prompt'), 'proof prompt\n')
writeFileSync(join(store, 'session.json'), JSON.stringify({
  session_id: id, governed: true, worktree_path: worktree, branch: `node/${id}`, node: '', title: 'proof', name: '', parent: '',
  status: 'idle', proposal: '', merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'claude', harness_session_id: '',
  stopped: true, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'fixture',
  launch_cmd: runner, launch_owner: '',
  create_request_id: '', create_payload_hash: '', zcode_child_session_ids: [], base: '',
}, null, 2) + '\n')
const tsx = realpathSync(execFileSync('which', ['tsx'], { encoding: 'utf8' }).trim())
const port = 18987 + (process.pid % 1000)
const tmuxSocket = `proof-${process.pid}`
const env = { ...process.env, HOME: root, PORT: String(port), SPEXCODE_HOME: home, SPEXCODE_TMUX: tmuxSocket }
const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const backend = spawn(process.execPath, [tsx, join(repo, 'spec-cli', 'src', 'index.ts')], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] })
let backendErr = ''; backend.stderr.on('data', chunk => { backendErr += String(chunk) })
const wait = async (url) => { for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) return } catch {} await new Promise(r => setTimeout(r, 50)) } throw new Error('backend did not start') }
try {
  await wait(`http://127.0.0.1:${port}/health`)
  const close = await fetch(`http://127.0.0.1:${port}/api/sessions/${id}/close`, { method: 'POST', signal: AbortSignal.timeout(10000) })
  const closeBody = await close.text(); assert.equal(close.status, 200, closeBody)
  const ref = run(project, ['rev-parse', '--verify', `refs/spex-archive/${id}`])
  assert.match(run(project, ['show', `${ref}:README.md`]), /dirty tracked/)
  assert.match(run(project, ['show', `${ref}:untracked.txt`]), /dirty untracked/)
  assert.equal(existsSync(worktree), false)
  assert.equal(run(project, ['show-ref', '--verify', `refs/heads/node/${id}`]).includes(`refs/heads/node/${id}`), true)
  assert.equal(existsSync(join(store, 'session.json')), true)
  const row = await fetch(`http://127.0.0.1:${port}/api/sessions/${id}`); assert.equal(row.status, 200)
  const resume = await fetch(`http://127.0.0.1:${port}/api/sessions/${id}/resume`, { method: 'POST', signal: AbortSignal.timeout(10000) })
  const resumeBody = await resume.text()
  if (resume.status >= 500) console.error(backendErr)
  assert.equal(existsSync(worktree), true, resumeBody)
  assert.equal(readFileSync(join(worktree, 'README.md'), 'utf8'), 'dirty tracked\n')
  assert.equal(readFileSync(join(worktree, 'untracked.txt'), 'utf8'), 'dirty untracked\n')
  console.log(JSON.stringify({ ok: true, id, ref, closeStatus: close.status, resumeStatus: resume.status, resumeBody }))
} catch (error) {
  console.error(backendErr)
  throw error
} finally {
  try { execFileSync('tmux', ['-L', tmuxSocket, 'kill-session', '-t', id], { stdio: 'ignore' }) } catch {}
  backend.kill('SIGTERM')
  await Promise.race([new Promise(resolve => backend.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 2000))])
}
