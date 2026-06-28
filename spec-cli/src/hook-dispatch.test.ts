import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'

const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const dispatch = join(repo, 'spec-cli', 'hooks', 'dispatch.sh')

test('dispatch exits 2 when a blocking handler emits decision:block JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-dispatch-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(dir, '.spec', 'x', '.config'), { recursive: true })
  mkdirSync(join(dir, 'hooks'), { recursive: true })
  mkdirSync(join(dir, 'rt'), { recursive: true })
  writeFileSync(join(dir, 'hooks', 'block.sh'), '#!/usr/bin/env bash\nprintf \'{"decision":"block","reason":"no"}\'\n')
  writeFileSync(join(dir, 'rt', 'hooks-manifest'), 'Stop\t10\ttrue\thooks/block.sh\n')
  const r = spawnSync('bash', [dispatch, 'codex', 'Stop'], {
    cwd: dir,
    env: { ...process.env, SPEX_HOOK_MANIFEST: join(dir, 'rt', 'hooks-manifest') },
    input: '{}',
    encoding: 'utf8',
  })
  assert.equal(r.status, 2)
  assert.match(r.stdout, /"decision":"block"/)
})
