import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    mkdirSync(join(project, '.spec'), { recursive: true })
    writeFileSync(join(project, '.spec/spexcode.json'), JSON.stringify({ harnesses: ['claude'] }) + '\n')
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
    process.env.SPEX_SESSION_DATABASE_PATH = join(home, 'sessions.sqlite')
    process.chdir(project)
    mkdirSync(sessionStoreDir(id), { recursive: true })
    writeFileSync(join(sessionStoreDir(id), 'runtime.json'), JSON.stringify({
      session_id: id, governed: true, worktree_path: project, branch: 'main', status: 'active',
    }) + '\n')
    const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, SPEXCODE_SESSION_ID: id, PORT: String(port) }
    delete env.SPEXCODE_API_URL

    const missingAdd = await runCli(project, env, 'session', 'files', 'add', '../never-created.txt')
    assert.equal(missingAdd.code, 1)
    assert.match(missingAdd.err, /spex: file does not exist:/)
    assert.equal(existsSync(sessionFilesPath(id)), false, 'a missing target is refused before the list changes')

    const add = await runCli(project, env, 'session', 'files', 'add', '../artifact.txt')
    assert.equal(add.code, 0, add.err)
    const absolute = resolve(project, '../artifact.txt')
    assert.equal(add.out.trim(), `posted ${absolute}\npoint at it as [[file:artifact.txt]]`)
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
    // a second file with a name already posted is pointed at by as much of its path as tells it apart
    mkdirSync(join(fixture, 'sub'), { recursive: true })
    writeFileSync(join(fixture, 'sub', 'artifact.txt'), 'twin\n')
    const addTwin = await runCli(project, env, 'session', 'files', 'add', '../sub/artifact.txt')
    assert.equal(addTwin.code, 0, addTwin.err)
    assert.equal(addTwin.out.trim(), `posted ${join(fixture, 'sub', 'artifact.txt')}\npoint at it as [[file:sub/artifact.txt]]`)
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

    // another session — a parent — reads this one's handoff by selector: the list, then one file's bytes by its
    // [[file:<name>]] tail. No governed caller, no backend needed for the bytes: the store and the disk.
    const reader: NodeJS.ProcessEnv = { ...env }
    for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete reader[key]
    const ownless = await runCli(project, reader, 'session', 'files', 'ls')
    assert.equal(ownless.code, 2)
    assert.match(ownless.err, /name the session to read \(spex session files ls <SEL>\)/)
    const asParent = await runCli(project, reader, 'session', 'files', 'ls', id)
    assert.equal(asParent.code, 0, asParent.err)
    assert.deepEqual(asParent.out.trim().split('\n'), [absolute, htmlAbsolute, join(fixture, 'sub', 'artifact.txt'), resolve(project, '../diagram.svg')])
    const gotHtml = await runCli(project, reader, 'session', 'files', 'get', id, '[[file:artifact.html]]')
    assert.equal(gotHtml.code, 0, gotHtml.err)
    assert.match(gotHtml.out, /<h1 id="proof">Rendered HTML<\/h1>/)
    const gotTwin = await runCli(project, reader, 'session', 'files', 'get', id, 'sub/artifact.txt')
    assert.deepEqual({ code: gotTwin.code, out: gotTwin.out }, { code: 0, out: 'twin\n' })
    const ambiguous = await runCli(project, reader, 'session', 'files', 'get', id, 'artifact.txt')
    assert.equal(ambiguous.code, 2)
    assert.match(ambiguous.err, /"artifact.txt" names 2 posted files — use more of the path/)
    const unknownName = await runCli(project, reader, 'session', 'files', 'get', id, 'private.txt')
    assert.equal(unknownName.code, 2)
    assert.match(unknownName.err, /no posted file named "private.txt"/)
    const saved = join(fixture, 'saved.html')
    const gotToFile = await runCli(project, reader, 'session', 'files', 'get', id, 'artifact.html', '-o', saved)
    assert.equal(gotToFile.code, 0, gotToFile.err)
    assert.match(gotToFile.out, new RegExp(`^wrote ${saved.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(\\d+ bytes from `))
    assert.equal(readFileSync(saved, 'utf8'), readFileSync(htmlArtifact, 'utf8'))
    const writerOnly = await runCli(project, reader, 'session', 'files', 'add', '../artifact.txt')
    assert.equal(writerOnly.code, 2)
    assert.match(writerOnly.err, /no governed caller session — run this from the agent session that produced the file/)

    writeFileSync(artifact, Buffer.alloc(SESSION_FILE_PREVIEW_MAX_BYTES + 1))
    const oversized = await fetch(`${base}/api/sessions/${id}/files/download?path=${encodeURIComponent(absolute)}&preview=1`)
    assert.deepEqual({ status: oversized.status, body: await oversized.json() }, {
      status: 413,
      body: { error: `preview is limited to 16 MiB; download this ${SESSION_FILE_PREVIEW_MAX_BYTES + 1}-byte file instead` },
    })

    rmSync(artifact)
    const invalidList = await runCli(project, env, 'session', 'files', 'ls')
    assert.equal(invalidList.code, 0, invalidList.err)
    assert.match(invalidList.out, new RegExp(`INVALID ${absolute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} .*file does not exist`))
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
    const retractTwin = await runCli(project, env, 'session', 'files', 'retract', '../sub/artifact.txt')
    assert.equal(retractTwin.code, 0, retractTwin.err)
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

test('a prompt that carries a completed upload posts it to the receiving session as the human\'s own file', { timeout: 120_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-sent-uploads-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const json = { 'content-type': 'application/json' }
  mkdirSync(join(project, '.spec', 'project'), { recursive: true })
  writeFileSync(join(project, '.spec/spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fake: { harness: 'claude', cmd: join(packageRoot, 'test', 'fixtures', 'fake-claude') } }, defaultLauncher: 'fake' },
  }) + '\n')
  writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n\n# project\n\nfixture project\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'uploads@example.test')
  git(project, 'config', 'user.name', 'uploads')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'fixture')
  const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, SPEXCODE_TMUX: `spex-sent-uploads-${process.pid}-${Date.now()}`, FAKE_HARNESS_INTERVAL_MS: '80' }
  delete env.SPEXCODE_API_URL
  delete env.SPEXCODE_SESSION_ID
  let log = ''
  const backend = spawn(process.execPath, [tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'serve', '--port', String(port)], {
    cwd: project, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  backend.stdout?.on('data', (chunk) => { log += String(chunk) })
  backend.stderr?.on('data', (chunk) => { log += String(chunk) })
  const uploaded: string[] = []
  let session: string | null = null
  const upload = async (name: string, bytes: string): Promise<string> => {
    const created = await fetch(`${base}/api/uploads`, { method: 'POST', headers: json, body: JSON.stringify({ name, size: Buffer.byteLength(bytes) }) })
    assert.equal(created.status, 201, await created.clone().text())
    const { id } = await created.json() as { id: string }
    const chunk = await fetch(`${base}/api/uploads/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' }, body: bytes })
    assert.equal(chunk.status, 200, await chunk.clone().text())
    const completed = await fetch(`${base}/api/uploads/${id}/complete`, { method: 'POST' })
    assert.equal(completed.status, 201, await completed.clone().text())
    const { path } = await completed.json() as { path: string }
    uploaded.push(path)
    return path
  }
  try {
    await waitForHealth(base, backend, () => log)
    const before = Date.now()
    const shot = await upload('screen shot.png', 'png bytes')
    const create = await fetch(`${base}/api/sessions`, { method: 'POST', headers: json, body: JSON.stringify({ prompt: `fix the layout in ${shot} please`, launcher: 'fake' }) })
    assert.equal(create.status, 201, await create.clone().text())
    session = (await create.json() as { id: string }).id
    const postedFiles = async (count: number): Promise<string[]> => {
      const deadline = Date.now() + 15_000
      for (;;) {
        const { files } = await fetch(`${base}/api/sessions/${session}/files`).then((response) => response.json()) as { files: string[] }
        if (files.length >= count || Date.now() > deadline) return files
        await new Promise((done) => setTimeout(done, 50))
      }
    }
    assert.deepEqual(await postedFiles(1), [shot])
    const row = await fetch(`${base}/api/sessions/${session}`).then((response) => response.json()) as { uploadedFiles: { path: string; name: string; uploadedAt: number }[] }
    assert.equal(row.uploadedFiles.length, 1)
    assert.deepEqual({ path: row.uploadedFiles[0].path, name: row.uploadedFiles[0].name }, { path: shot, name: 'screen_shot.png' })
    assert.ok(row.uploadedFiles[0].uploadedAt >= before - 1000 && row.uploadedFiles[0].uploadedAt <= Date.now(), 'the upload time is read back from the completed name')

    // a Command Box send: a second upload at the end of a sentence posts; the already-posted one is not
    // duplicated; a vanished upload and an ordinary host path are left alone
    const buildLog = await upload('build.log', 'log line\n')
    const vanished = join(dirname(shot), `${Date.now().toString(36)}-00000000-0000-4000-8000-000000000000-gone.txt`)
    const sent = await fetch(`${base}/api/sessions/${session}/input`, {
      method: 'POST', headers: json, body: JSON.stringify({ kind: 'command', text: `also see ${buildLog}. then ${shot}, ${vanished} and /etc/hosts` }),
    })
    assert.equal(sent.status, 200, await sent.clone().text())
    assert.deepEqual(await postedFiles(2), [shot, buildLog])
    const graph = await fetch(`${base}/api/graph`).then((response) => response.json()) as { sessions: { id: string; uploadedFiles?: { path: string }[] }[] }
    assert.deepEqual(graph.sessions.find((candidate) => candidate.id === session)?.uploadedFiles?.map((file) => file.path), [shot, buildLog])
    const download = await fetch(`${base}/api/sessions/${session}/files/download?path=${encodeURIComponent(buildLog)}`)
    assert.deepEqual({ status: download.status, body: await download.text() }, { status: 200, body: 'log line\n' })

    // an agent's own posted path is listed but is not the human's upload
    const agentFile = join(fixture, 'report.html')
    writeFileSync(agentFile, '<h1>report</h1>\n')
    const agentPost = await runCli(project, { ...env, SPEXCODE_SESSION_ID: session }, 'session', 'files', 'add', agentFile)
    assert.equal(agentPost.code, 0, agentPost.err)
    const mixed = await fetch(`${base}/api/sessions/${session}`).then((response) => response.json()) as { files: string[]; uploadedFiles: { path: string }[] }
    assert.deepEqual(mixed.files, [shot, buildLog, agentFile])
    assert.deepEqual(mixed.uploadedFiles.map((file) => file.path), [shot, buildLog])
  } finally {
    if (session) await fetch(`${base}/api/sessions/${session}/close`, { method: 'POST' }).catch(() => {})
    if (backend.pid && backend.exitCode === null) {
      try { process.kill(-backend.pid, 'SIGTERM') } catch { backend.kill('SIGTERM') }
      await new Promise<void>((done) => backend.once('close', () => done()))
    }
    for (const path of uploaded) rmSync(path, { force: true })
    rmSync(fixture, { recursive: true, force: true })
  }
})
