import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runDoctor } from './doctor.js'
import { tsxBin } from './tsx-bin.js'

const SRC = dirname(fileURLToPath(import.meta.url))
const CLI = join(SRC, 'cli.ts')
const TSX = tsxBin(join(SRC, '..'))

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

test('bare doctor diagnoses an adopted repository before its first commit without writing', () => {
  const project = mkdtempSync(join(tmpdir(), 'spex-doctor-unborn-project-'))
  const runtime = mkdtempSync(join(tmpdir(), 'spex-doctor-unborn-runtime-'))
  const codexHome = mkdtempSync(join(tmpdir(), 'spex-doctor-unborn-codex-'))
  const env = { ...process.env, SPEXCODE_HOME: runtime, CODEX_HOME: codexHome }
  const cli = (...args: string[]) => spawnSync(process.execPath, [TSX, CLI, ...args], {
    cwd: project,
    env,
    encoding: 'utf8',
  })
  const status = () => execFileSync('git', ['-C', project, 'status', '--porcelain=v1'], { encoding: 'utf8', env })

  try {
    execFileSync('git', ['-C', project, 'init', '-q', '-b', 'main'], { env })
    execFileSync('git', ['-C', project, 'config', 'user.email', 'doctor-test@example.invalid'], { env })
    execFileSync('git', ['-C', project, 'config', 'user.name', 'Doctor Test'], { env })

    const adopted = cli('init', '--harness', 'codex')
    assert.equal(adopted.status, 0, `${adopted.stdout}\n${adopted.stderr}`)
    const unborn = spawnSync('git', ['-C', project, 'rev-parse', '--verify', 'HEAD'], { env, encoding: 'utf8' })
    assert.notEqual(unborn.status, 0, 'fixture must remain before its first commit')

    const before = status()
    const diagnosis = cli('doctor')
    assert.equal(diagnosis.status, 0, `${diagnosis.stdout}\n${diagnosis.stderr}`)
    assert.match(diagnosis.stdout, /Spec health diagnosis/)
    assert.match(diagnosis.stdout, /altitude\s+:/)
    assert.match(diagnosis.stdout, /breadth\s+:/)
    for (const layer of ['Layer 1', 'Layer 2', 'Layer 3', 'Layer 4', 'Layer 5'])
      assert.match(diagnosis.stdout, new RegExp(layer))
    assert.equal(status(), before, 'doctor must not create, stage, or change adoption files')
  } finally {
    rmSync(project, { recursive: true, force: true })
    rmSync(runtime, { recursive: true, force: true })
    rmSync(codexHome, { recursive: true, force: true })
  }
})
