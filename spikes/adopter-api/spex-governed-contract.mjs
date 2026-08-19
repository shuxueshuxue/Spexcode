import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = mkdtempSync(join(tmpdir(), 'adopter-spex-governed-'))
const db = join(root, 'spexcode.sqlite')
const script = process.env.ADOPTER_API_SPEX_GOVERNED_STUB === '1'
  ? fileURLToPath(new URL('./stubs/spex-governed-sequence-wrong-shape.mjs', import.meta.url))
  : fileURLToPath(new URL('./spex-governed-sequence.mjs', import.meta.url))

function child(mode) {
  const result = spawnSync(process.execPath, [script, mode, db], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${mode} failed\nstdout=${result.stdout}\nstderr=${result.stderr}`)
  return JSON.parse(result.stdout)
}

try {
  const produced = child('producer')
  if (produced.projectId !== 'project-a' || produced.parentSessionId !== 'parent-a' || produced.enqueued !== 'child-ready-1') {
    throw new Error('producer contract')
  }
  const consumed = child('consumer')
  if (consumed.messageId !== 'child-ready-1' || consumed.adapterInput !== 'child is ready' || consumed.journaled !== true) {
    throw new Error('consumer adapter/journal contract')
  }
  process.stdout.write(JSON.stringify({ ok: true, produced, consumed }) + '\n')
} finally {
  rmSync(root, { recursive: true, force: true })
}
