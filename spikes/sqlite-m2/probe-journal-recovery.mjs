// After a SIGKILL mid-transaction, when exactly is the hot rollback journal consumed?
// Measured step by step, because "the data is correct" and "the journal file is gone" are different
// claims and only the first one is about correctness.
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openProtocol } from './engine.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'sqlite-m2-recovery-'))
const path = join(dir, 'protocol.sqlite')

const sidecars = () => readdirSync(dir).filter(f => f !== 'protocol.sqlite').map(f => {
  const size = statSync(join(dir, f)).size
  return `${f} (${size} bytes)`
}).sort()

const setup = openProtocol(path)
setup.initialize('crash')
setup.enqueue('crash', { kind: 'seed.v1', body: Buffer.from('already-committed') })
setup.close()
console.log('before crash          :', JSON.stringify(sidecars()))

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [join(here, 'worker.mjs'), path, 'crash-precommit', '0', 'crash'],
    { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', d => { out += d; if (out.includes('staged')) { child.kill('SIGKILL'); resolve() } })
  child.on('close', () => reject(new Error('worker exited before staging')))
})
console.log('after SIGKILL         :', JSON.stringify(sidecars()))

const readOnly = openProtocol(path, { readOnly: true })
console.log('read-only open, rows  :', readOnly.listPending('crash').length)
readOnly.close()
console.log('after read-only open  :', JSON.stringify(sidecars()))

const reader = openProtocol(path)
console.log('writable open, rows   :', reader.listPending('crash').length, '(1 = the committed seed only)')
console.log('after a READ          :', JSON.stringify(sidecars()))
reader.enqueue('crash', { kind: 'after.v1', body: Buffer.from('after-recovery') })
console.log('after a WRITE         :', JSON.stringify(sidecars()))
console.log('rows now              :', reader.listPending('crash').length)
reader.close()
console.log('after close           :', JSON.stringify(sidecars()))

rmSync(dir, { recursive: true, force: true })
