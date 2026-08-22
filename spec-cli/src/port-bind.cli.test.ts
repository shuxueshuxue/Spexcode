import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { listenOrExit } from './listen.js'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))

async function occupyPort(host?: string): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer()
  server.listen(0, host)
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return {
    port: address.port,
    close: async () => {
      server.close()
      await once(server, 'close')
    },
  }
}

type CliProcess = { child: ChildProcess; stdout: () => string; stderr: () => string }

function startCli(args: string[]): CliProcess {
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), cli, ...args], {
    cwd: packageRoot,
    env: { ...process.env, SPEXCODE_API_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  return { child, stdout: () => stdout, stderr: () => stderr }
}

async function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const running = startCli(args)
  const [code] = await once(running.child, 'close') as [number | null]
  return { code, stdout: running.stdout(), stderr: running.stderr() }
}

async function waitFor(check: () => boolean, running: CliProcess, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (running.child.exitCode !== null || running.child.signalCode !== null || Date.now() >= deadline) {
      assert.fail(`CLI did not become ready\nstdout:\n${running.stdout()}\nstderr:\n${running.stderr()}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function stop(running: CliProcess): Promise<void> {
  if (running.child.exitCode !== null || running.child.signalCode !== null) return
  running.child.kill('SIGTERM')
  await once(running.child, 'close')
}

test('public ready lines follow bind and busy listeners publish none', { timeout: 120_000 }, async () => {
  const dashboardReadyPort = await occupyPort('127.0.0.1')
  const readyPort = dashboardReadyPort.port
  await dashboardReadyPort.close()
  const readyDashboard = startCli(['serve', 'ui', '--port', String(readyPort), '--api-port', '1'])
  try {
    await waitFor(() => readyDashboard.stdout().includes(`[gateway] dashboard on http://localhost:${readyPort}`), readyDashboard)
    assert.match(readyDashboard.stdout(), /^\[dashboard\] serving .+[/\\]spec-dashboard[/\\]dist, \/api → backend :1$/m)
    assert.ok(readyDashboard.stdout().indexOf('[dashboard] serving ') < readyDashboard.stdout().indexOf('[gateway] dashboard on '))
    assert.equal((await fetch(`http://127.0.0.1:${readyPort}/`)).status, 200)
  } finally {
    await stop(readyDashboard)
  }

  const backendPort = await occupyPort()
  try {
    const backend = await runCli(['serve', '--port', String(backendPort.port)])
    assert.equal(backend.code, 1, backend.stderr)
    assert.doesNotMatch(backend.stdout, /^spec-cli serving /m)
    assert.doesNotMatch(backend.stdout, /^spec-cli supervisor serving /m)
    assert.deepEqual(backend.stderr.match(/^spec-cli: supervisor cannot bind .+$/gm), [
      `spec-cli: supervisor cannot bind — port ${backendPort.port} is already in use. Free :${backendPort.port} (e.g. lsof -i :${backendPort.port}) or pick another port, then retry.`,
    ], `stdout:\n${backend.stdout}\nstderr:\n${backend.stderr}`)
  } finally {
    await backendPort.close()
  }

  const dashboardPort = await occupyPort('127.0.0.1')
  try {
    const dashboard = await runCli(['serve', 'ui', '--port', String(dashboardPort.port), '--api-port', '1'])
    assert.equal(dashboard.code, 1, dashboard.stderr)
    assert.doesNotMatch(dashboard.stdout, /^\[dashboard\] serving /m)
    assert.doesNotMatch(dashboard.stdout, /^\[gateway\].+ on /m)
    assert.deepEqual(dashboard.stderr.match(/^spec-cli: dashboard cannot bind .+$/gm), [
      `spec-cli: dashboard cannot bind — port ${dashboardPort.port} is already in use. Free :${dashboardPort.port} (e.g. lsof -i :${dashboardPort.port}) or pick another port, then retry.`,
    ], `stdout:\n${dashboard.stdout}\nstderr:\n${dashboard.stderr}`)
  } finally {
    await dashboardPort.close()
  }
})

test('backend port 0 publishes the kernel-assigned port', { timeout: 120_000 }, async () => {
  const backend = startCli(['serve', '--port', '0'])
  try {
    await waitFor(() => backend.stdout().includes('spec-cli supervisor serving on http://localhost:'), backend)
    const match = backend.stdout().match(/^spec-cli supervisor serving on http:\/\/localhost:(\d+) /m)
    assert.ok(match, `missing supervisor ready line:\n${backend.stdout()}`)
    const port = Number(match[1])
    assert.ok(port > 0, `expected an assigned port, got ${port}`)
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200)
  } finally {
    await stop(backend)
  }
})

test('listenOrExit passes the bound port to ready publication', async () => {
  const server = net.createServer()
  let publishedPort: number | undefined
  await new Promise<void>((resolve) => {
    listenOrExit(server, 0, {
      label: 'test listener',
      ready: (port) => {
        publishedPort = port
        resolve()
        return `test listener on :${port}`
      },
    })
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  assert.equal(publishedPort, address.port)
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})
