import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { processStartToken } from '../src/process-identity.js'
import { createSessionMaintenance } from '../src/session-maintenance.js'

const [runtimeRoot, startBarrier, releaseBarrier, readyDir, resultDir, byteText] = process.argv.slice(2)
if (!runtimeRoot || !startBarrier || !releaseBarrier || !readyDir || !resultDir || !byteText) {
  throw new Error('usage: cas-fixture <root> <start-barrier> <release-barrier> <ready-dir> <result-dir> <byte>')
}
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

writeFileSync(join(readyDir, `${process.pid}.ready`), '')
while (!existsSync(startBarrier)) await new Promise((resolve) => setTimeout(resolve, 5))
let result: { pid: number; ok: boolean; epoch?: number; code?: string }
let lease: { token: string; epoch: number } | null = null
try {
  lease = await gate.acquireLease({ capabilities: [], owner: { pid: process.pid, startToken }, ttlMs: 30_000, waitMs: 0 })
  result = { pid: process.pid, ok: true, epoch: lease.epoch }
} catch (error: any) {
  result = { pid: process.pid, ok: false, code: error?.code ?? 'unknown' }
}
writeFileSync(join(resultDir, `${process.pid}.json`), JSON.stringify(result))
process.stdout.write(JSON.stringify(result))
if (lease) {
  while (!existsSync(releaseBarrier)) await new Promise((resolve) => setTimeout(resolve, 5))
  await gate.releaseLease({ token: lease.token, epoch: lease.epoch })
}
