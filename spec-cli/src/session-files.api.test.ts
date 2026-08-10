import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { SESSION_FILE_PREVIEW_MAX_BYTES, sessionFilesPath } from './session-files.js'
import { sessionStoreDir } from '@spexcode/spec-core'
import { tsxBin } from './tsx-bin.js'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
}

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done) })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done()))
  return address.port
}

async function runCli(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  const child = spawn(process.execPath, [tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = '', err = ''
  child.stdout?.on('data', (chunk) => { out += String(chunk) })
  child.stderr?.on('data', (chunk) => { err += String(chunk) })
  await new Promise<void>((done) => child.once('close', done))
  return { code: child.exitCode, out, err }
}

async function waitForHealth(base: string, child: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if ((await fetch(`${base}/health`).catch(() => null))?.ok) return
    if (child.exitCode !== null) throw new Error(`backend exited early: ${log()}`)
    await new Promise((done) => setTimeout(done, 50))
  }
  throw new Error(`backend never became healthy: ${log()}`)
}

test('public session files CLI stores a live path and the backend authorizes only that path', { timeout: 30_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-session-files-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const artifact = join(fixture, 'artifact.txt')
  const htmlArtifact = join(fixture, 'artifact.html')
  const unposted = join(fixture, 'private.txt')
  const neverPosted = join(fixture, 'never-posted.txt')
  const unpreviewable = join(fixture, 'diagram.svg')
  const id = 'files-session'
  const port = await freePort()
  const previousCwd = process.cwd()
  const previousHome = process.env.SPEXCODE_HOME
  let backend: ChildProcess | null = null
  try {
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['claude'] }) + '\n')
    writeFileSync(join(project, 'README.md'), 'fixture\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.email', 'files@example.test')
    git(project, 'config', 'user.name', 'files')
    git(project, 'add', '.')
    git(project, 'commit', '-qm', 'fixture')
    writeFileSync(artifact, 'before\n')
    writeFileSync(htmlArtifact, '<!doctype html><h1 id="proof">Rendered HTML</h1><script>document.body.dataset.scriptRan = "yes"</script>\n')
    writeFileSync(unposted, 'private\n')
    writeFileSync(unpreviewable, '<svg/>\n')

    process.env.SPEXCODE_HOME = home
    process.chdir(project)
    mkdirSync(sessionStoreDir(id), { recursive: true })
    writeFileSync(join(sessionStoreDir(id), 'session.json'), JSON.stringify({ session_id: id }) + '\n')
    const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, SPEXCODE_SESSION_ID: id, PORT: String(port) }
    delete env.SPEXCODE_API_URL

    const add = await runCli(project, env, 'session', 'files', 'add', '../artifact.txt')
    assert.equal(add.code, 0, add.err)
    const absolute = resolve(project, '../artifact.txt')
    assert.equal(add.out.trim(), `posted ${absolute}`)
    assert.equal(readFileSync(artifact, 'utf8'), 'before\n')
    assert.deepEqual(JSON.parse(readFileSync(sessionFilesPath(id), 'utf8')), [absolute])

    const listed = await runCli(project, env, 'session', 'files', 'ls')
    assert.deepEqual({ code: listed.code, out: listed.out.trim() }, { code: 0, out: absolute })

    let log = ''
    backend = spawn(process.execPath, [tsxBin(packageRoot), join(packageRoot, 'src', 'index.ts')], {
      cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'],
    })
    backend.stdout?.on('data', (chunk) => { log += String(chunk) })
    backend.stderr?.on('data', (chunk) => { log += String(chunk) })
    const base = `http://127.0.0.1:${port}`
    await waitForHealth(base, backend, () => log)

    writeFileSync(artifact, 'after\n')
    const listedByApi = await fetch(`${base}/api/sessions/${id}/files`).then((response) => response.json())
    assert.deepEqual(listedByApi, { files: [absolute] })
    const download = await fetch(`${base}/api/sessions/${id}/files/download?path=${encodeURIComponent(absolute)}`)
    assert.equal(download.status, 200)
    assert.equal(await download.text(), 'after\n')
    const preview = await fetch(`${base}/api/sessions/${id}/files/download?path=${encodeURIComponent(absolute)}&preview=1`)
    assert.equal(preview.status, 200)
    assert.equal(preview.headers.get('X-Spexcode-Preview-Kind'), 'text')
    assert.equal(await preview.text(), 'after\n')
    const addHtml = await runCli(project, env, 'session', 'files', 'add', '../artifact.html')
    assert.equal(addHtml.code, 0, addHtml.err)
    const htmlAbsolute = resolve(project, '../artifact.html')
    const htmlPreview = await fetch(`${base}/api/sessions/${id}/files/download?path=${encodeURIComponent(htmlAbsolute)}&preview=1`)
    assert.equal(htmlPreview.status, 200)
    assert.equal(htmlPreview.headers.get('X-Spexcode-Preview-Kind'), 'html')
    assert.equal(htmlPreview.headers.get('Content-Type'), 'text/html; charset=utf-8')
    assert.match(await htmlPreview.text(), /<h1 id="proof">Rendered HTML<\/h1>/)
    const addUnpreviewable = await runCli(project, env, 'session', 'files', 'add', '../diagram.svg')
    assert.equal(addUnpreviewable.code, 0, addUnpreviewable.err)
    const unsupported = await fetch(`${base}/api/sessions/${id}/files/download?path=${encodeURIComponent(resolve(project, '../diagram.svg'))}&preview=1`)
    assert.deepEqual({ status: unsupported.status, body: await unsupported.json() }, {
      status: 415,
      body: { error: 'no preview for this file type; download it instead' },
    })
    const forbidden = await fetch(`${base}/api/sessions/${id}/files/download?path=${encodeURIComponent(unposted)}`)
    assert.deepEqual({ status: forbidden.status, body: await forbidden.json() }, { status: 403, body: { error: 'that path was not posted by this session' } })
    const forbiddenPreview = await fetch(`${base}/api/sessions/${id}/files/download?path=${encodeURIComponent(unposted)}&preview=1`)
    assert.deepEqual({ status: forbiddenPreview.status, body: await forbiddenPreview.json() }, { status: 403, body: { error: 'that path was not posted by this session' } })
    const forbiddenMissing = await fetch(`${base}/api/sessions/${id}/files/download?path=${encodeURIComponent(neverPosted)}`)
    assert.deepEqual({ status: forbiddenMissing.status, body: await forbiddenMissing.json() }, { status: 403, body: { error: 'that path was not posted by this session' } })

    writeFileSync(artifact, Buffer.alloc(SESSION_FILE_PREVIEW_MAX_BYTES + 1))
    const oversized = await fetch(`${base}/api/sessions/${id}/files/download?path=${encodeURIComponent(absolute)}&preview=1`)
    assert.deepEqual({ status: oversized.status, body: await oversized.json() }, {
      status: 413,
      body: { error: `preview is limited to 2 MiB; download this ${SESSION_FILE_PREVIEW_MAX_BYTES + 1}-byte file instead` },
    })

    rmSync(artifact)
    const missing = await fetch(`${base}/api/sessions/${id}/files/download?path=${encodeURIComponent(absolute)}`, { method: 'HEAD' })
    assert.equal(missing.status, 404)

    const retract = await runCli(project, env, 'session', 'files', 'retract', '../artifact.txt')
    assert.deepEqual({ code: retract.code, out: retract.out.trim() }, { code: 0, out: `retracted ${absolute}` })
    const retractUnpreviewable = await runCli(project, env, 'session', 'files', 'retract', '../diagram.svg')
    assert.deepEqual({ code: retractUnpreviewable.code, out: retractUnpreviewable.out.trim() }, {
      code: 0,
      out: `retracted ${resolve(project, '../diagram.svg')}`,
    })
    const retractHtml = await runCli(project, env, 'session', 'files', 'retract', '../artifact.html')
    assert.deepEqual({ code: retractHtml.code, out: retractHtml.out.trim() }, {
      code: 0,
      out: `retracted ${resolve(project, '../artifact.html')}`,
    })
    assert.deepEqual(JSON.parse(readFileSync(sessionFilesPath(id), 'utf8')), [])
  } finally {
    process.chdir(previousCwd)
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (backend?.exitCode === null) {
      backend.kill('SIGTERM')
      await new Promise<void>((done) => backend?.once('close', () => done()))
    }
    rmSync(fixture, { recursive: true, force: true })
  }
})
