import assert from 'node:assert/strict'
import test from 'node:test'
import { runDoctor } from './doctor.js'

async function captureError(run: () => Promise<number>): Promise<{ code: number; output: string }> {
  const lines: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  try {
    return { code: await run(), output: lines.join('\n') }
  } finally {
    console.error = original
  }
}

test('doctor exposes diagnosis only; retired writes never execute', async () => {
  const help = await captureError(() => runDoctor(['help']))
  assert.equal(help.code, 0)
  assert.match(help.output, /--contract/)
  assert.match(help.output, /--conflicts/)
  assert.doesNotMatch(help.output, /migrate|install|uninstall/)

  const migration = await captureError(() => runDoctor(['--migrate']))
  assert.equal(migration.code, 2)
  assert.match(migration.output, /removed in v0\.4\.0/)
  assert.match(migration.output, /0\.3\.x SpexCode release/)

  for (const spelling of ['install', 'uninstall']) {
    const retired = await captureError(() => runDoctor([spelling]))
    assert.equal(retired.code, 2)
    assert.match(retired.output, /unknown subcommand/)
  }
})
