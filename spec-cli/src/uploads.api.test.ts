import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const BYTES_PER_MEBIBYTE = 1024 * 1024
const DEFAULT_UPLOADS = JSON.parse(readFileSync(join(here, '../templates/spexcode.json'), 'utf8')).uploads as Record<string, number>
const ONE_BYTE = 1
const LOCAL_CHUNK_DIVISOR = 2
const LOCAL_CHUNK_BYTES = DEFAULT_UPLOADS.chunkBytes / LOCAL_CHUNK_DIVISOR
const LOCAL_CONCURRENCY = 2
const LOCAL_REQUEST_TIMEOUT_MS = 30_000
const LOCAL_RETRY_LIMIT = 1
const LOCAL_RETRY_DELAY_MS = 25
const LARGE_FILE_CHUNK_COUNT = 16
const LARGE_FILE_TAIL_BYTES = 19
const INTERRUPTED_PREFIX_BYTES = BYTES_PER_MEBIBYTE
const INTERRUPT_SETTLE_MS = 50
const POLL_TIMEOUT_MS = 10_000
const POLL_INTERVAL_MS = 25
const STOP_GRACE_MS = 3_000

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
}

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

async function waitFor(check: () => boolean | Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (!await check()) {
    if (Date.now() >= deadline) assert.fail(message)
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const timedOut = await Promise.race([
    once(child, 'exit').then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), STOP_GRACE_MS)),
  ])
  if (timedOut && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

test('real backend resumes a configured large attachment and promotes only the complete bytes', { timeout: 90_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-upload-api-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const uploadTmp = join(fixture, 'tmp')
  const port = await freePort()
  let child: ChildProcess | null = null
  try {
    mkdirSync(join(project, '.spec', 'project'), { recursive: true })
    mkdirSync(uploadTmp)
    writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n# project\n')
    const portableMaxBytes = DEFAULT_UPLOADS.maxBytes - ONE_BYTE
    const expectedPolicy = {
      ...DEFAULT_UPLOADS,
      maxBytes: portableMaxBytes,
      chunkBytes: LOCAL_CHUNK_BYTES,
      concurrency: LOCAL_CONCURRENCY,
      requestTimeoutMs: LOCAL_REQUEST_TIMEOUT_MS,
      retryLimit: LOCAL_RETRY_LIMIT,
      retryDelayMs: LOCAL_RETRY_DELAY_MS,
    }
    writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['claude'], uploads: { maxBytes: portableMaxBytes } }) + '\n')
    writeFileSync(join(project, '.gitignore'), 'spexcode.local.json\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.email', 'uploads@example.test')
    git(project, 'config', 'user.name', 'uploads test')
    git(project, 'add', '.')
    git(project, 'commit', '-qm', 'fixture')
    // The backend must read this machine-local section through the existing one-level config overlay, not a
    // separate upload configuration path. Omitted fields continue to come from the shipped template.
    writeFileSync(join(project, 'spexcode.local.json'), JSON.stringify({ uploads: {
      chunkBytes: LOCAL_CHUNK_BYTES,
      concurrency: LOCAL_CONCURRENCY,
      requestTimeoutMs: LOCAL_REQUEST_TIMEOUT_MS,
      retryLimit: LOCAL_RETRY_LIMIT,
      retryDelayMs: LOCAL_RETRY_DELAY_MS,
    } }) + '\n')

    let log = ''
    child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(here, 'index.ts')], {
      cwd: project,
      env: { ...process.env, PORT: String(port), TMPDIR: uploadTmp, SPEXCODE_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', (chunk) => { log += String(chunk) })
    child.stderr?.on('data', (chunk) => { log += String(chunk) })
    const base = `http://127.0.0.1:${port}`
    await waitFor(async () => (await fetch(`${base}/health`).catch(() => null))?.ok === true, `backend did not become healthy: ${log}`)

    const total = LARGE_FILE_CHUNK_COUNT * LOCAL_CHUNK_BYTES + LARGE_FILE_TAIL_BYTES
    const created = await fetch(`${base}/api/uploads`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '../../large proof.bin', size: total }),
    })
    assert.equal(created.status, 201)
    const transfer = await created.json() as { id: string; offset: number; chunkBytes: number; concurrency: number; requestTimeoutMs: number; retryLimit: number; retryDelayMs: number; size: number; name: string }
    assert.deepEqual({
      offset: transfer.offset, chunkBytes: transfer.chunkBytes, concurrency: transfer.concurrency,
      requestTimeoutMs: transfer.requestTimeoutMs, retryLimit: transfer.retryLimit, retryDelayMs: transfer.retryDelayMs,
      size: transfer.size, name: transfer.name,
    }, {
      offset: 0, chunkBytes: expectedPolicy.chunkBytes, concurrency: expectedPolicy.concurrency,
      requestTimeoutMs: expectedPolicy.requestTimeoutMs, retryLimit: expectedPolicy.retryLimit, retryDelayMs: expectedPolicy.retryDelayMs,
      size: total, name: 'large_proof.bin',
    })

    // Lose a live request after it has written a prefix. The server must report the physical staging length,
    // so the next PATCH starts at that offset instead of restarting or exposing a partial final path.
    const interrupted = http.request({
      host: '127.0.0.1', port, path: `/api/uploads/${transfer.id}`, method: 'PATCH',
      headers: { 'content-type': 'application/offset+octet-stream', 'upload-offset': '0', 'content-length': String(transfer.chunkBytes) },
    })
    interrupted.on('error', () => {})
    interrupted.write(Buffer.alloc(INTERRUPTED_PREFIX_BYTES, 0x5a))
    await new Promise((resolve) => setTimeout(resolve, INTERRUPT_SETTLE_MS))
    interrupted.destroy()
    let resumed: { offset: number; chunkBytes: number } | null = null
    await waitFor(async () => {
      const response = await fetch(`${base}/api/uploads/${transfer.id}`)
      if (!response.ok) return false
      resumed = await response.json() as { offset: number; chunkBytes: number }
      return resumed.offset > 0
    }, 'interrupted upload prefix to become resumable')
    const resumedTransfer = resumed as unknown as { offset: number; chunkBytes: number }
    assert.ok(resumedTransfer.offset < transfer.chunkBytes, `interrupted request committed a whole chunk: ${resumedTransfer.offset}`)

    let offset = resumedTransfer.offset
    const stale = await fetch(`${base}/api/uploads/${transfer.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
      body: Buffer.from('repeat'),
    })
    assert.equal(stale.status, 409)
    assert.deepEqual(await stale.json(), { error: 'upload offset does not match the committed bytes', offset })

    for (; offset < total;) {
      const bytes = Math.min(transfer.chunkBytes, total - offset)
      const chunk = Buffer.alloc(bytes, 0x5a)
      const response = await fetch(`${base}/api/uploads/${transfer.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/offset+octet-stream', 'upload-offset': String(offset) },
        body: chunk,
      })
      assert.equal(response.status, 200)
      const next = await response.json() as { offset: number }
      offset += bytes
      assert.equal(next.offset, offset)
    }

    const complete = await fetch(`${base}/api/uploads/${transfer.id}/complete`, { method: 'POST' })
    assert.equal(complete.status, 201)
    const { path } = await complete.json() as { path: string }
    assert.match(path, /spexcode-uploads\/.+-large_proof\.bin$/)
    assert.equal(statSync(path).size, total)
    assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), createHash('sha256').update(Buffer.alloc(total, 0x5a)).digest('hex'))
    assert.equal((await fetch(`${base}/api/uploads/${transfer.id}`)).status, 404)

    const cancelled = await fetch(`${base}/api/uploads`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'cancel.bin', size: ONE_BYTE }),
    }).then((response) => response.json()) as { id: string }
    assert.equal((await fetch(`${base}/api/uploads/${cancelled.id}`, { method: 'DELETE' })).status, 204)
    assert.equal((await fetch(`${base}/api/uploads/${cancelled.id}`)).status, 404)

    const empty = await fetch(`${base}/api/uploads`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'empty.bin', size: 0 }),
    })
    assert.deepEqual({ status: empty.status, body: await empty.json() }, { status: 400, body: { error: 'file must not be empty' } })
    const tooLarge = await fetch(`${base}/api/uploads`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'too-large.bin', size: portableMaxBytes + ONE_BYTE }),
    })
    assert.deepEqual({ status: tooLarge.status, body: await tooLarge.json() }, { status: 413, body: { error: 'file exceeds the configured upload limit' } })
  } finally {
    if (child) await stop(child)
    rmSync(fixture, { recursive: true, force: true })
  }
})
