import { existsSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { processStartToken } from '../src/process-identity.js'
import { createSessionMaintenance } from '../src/session-maintenance.js'

const [runtimeRoot, barrier, readyDir, byteText] = process.argv.slice(2)
if (!runtimeRoot || !barrier || !readyDir || !byteText) throw new Error('usage: cas-fixture <root> <barrier> <ready-dir> <byte>')
const startToken = processStartToken(process.pid)
if (!startToken) throw new Error(`no process start token for ${process.pid}`)
const gate = createSessionMaintenance({
  runtimeRoot,
  now: () => Date.now(),
  randomBytes: (size: number) => Buffer.alloc(size, Number(byteText)),
  processIdentity: (pid: number) => {
    const token = processStartToken(pid)
    return token ? { pid, startToken: token } : null
  },
  selfIdentity: () => ({ pid: process.pid, startToken }),
  ticketReportMs: 1_000,
})

writeFileSync(join(readyDir, basename(`${process.pid}.ready`)), '')
while (!existsSync(barrier)) await new Promise((resolve) => setTimeout(resolve, 5))
try {
  const lease = await gate.acquireLease({ capabilities: [], owner: { pid: process.pid, startToken }, ttlMs: 30_000, waitMs: 0 })
  process.stdout.write(JSON.stringify({ ok: true, epoch: lease.epoch }))
} catch (error: any) {
  process.stdout.write(JSON.stringify({ ok: false, code: error?.code ?? 'unknown' }))
}
