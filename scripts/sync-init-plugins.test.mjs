import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { LIVE_PLUGINS, buildProjection, projectionDiff, writeProjection } from './sync-init-plugins.mjs'

function write(path, content, mode = 0o644) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  chmodSync(path, mode)
}

test('init plugin projection derives content, membership, links, and helper files from one live tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-init-plugins-'))
  const specRoot = join(root, '.spec')
  const plugins = join(specRoot, 'spexcode', '.plugins')
  const target = join(root, 'template', '.plugins')
  try {
    write(join(specRoot, 'spexcode', 'outside', 'spec.md'), '---\ntitle: outside\n---\noutside\n')
    write(join(plugins, 'spec.md'), '---\ntitle: .plugins\n---\nroot\n')
    write(join(plugins, 'shared', 'spec.md'), [
      '---',
      'title: shared',
      '---',
      'keep [[shared]], unwrap [[held]] and [[outside]], preserve `[[outside]]`.',
      'path: .spec/spexcode/.plugins/shared/run.sh',
      '',
    ].join('\n'))
    write(join(plugins, 'shared', 'run.sh'), '#!/bin/sh\n', 0o755)
    write(join(plugins, 'shared', 'eval.md'), '---\nscenarios:\n  - name: shared\n    code: .spec/spexcode/.plugins/shared/run.sh\n---\n')
    write(join(plugins, 'shared', 'evals.ndjson'), '{"codeSha":"dogfood-only"}\n')
    write(join(plugins, 'held', 'spec.md'), '---\ntitle: held\nseed: false\n---\nheld\n')
    write(join(plugins, 'held', 'secret.txt'), 'secret\n')

    const projection = buildProjection({ sourceDir: plugins, specRoot })
    assert.deepEqual([...projection.keys()].sort(), ['shared/run.sh', 'shared/spec.md', 'spec.md'])
    const shared = projection.get('shared/spec.md').content.toString('utf8')
    assert.match(shared, /keep \[\[shared\]\], unwrap held and outside, preserve `\[\[outside\]\]`/)
    assert.match(shared, /\.spec\/project\/\.plugins\/shared\/run\.sh/)

    writeProjection(projection, target)
    assert.deepEqual(projectionDiff(projection, target), [])
    assert.ok(statSync(join(target, 'shared', 'run.sh')).mode & 0o111, 'helper executable mode is preserved')

    chmodSync(join(target, 'shared', 'run.sh'), 0o644)
    assert.deepEqual(projectionDiff(projection, target), ['mode: shared/run.sh'])
    chmodSync(join(target, 'shared', 'run.sh'), 0o755)

    writeFileSync(join(target, 'shared', 'spec.md'), 'one-sided edit\n')
    rmSync(join(target, 'shared', 'run.sh'))
    write(join(target, 'extra.txt'), 'extra\n')
    assert.deepEqual(projectionDiff(projection, target), [
      'extra: extra.txt',
      'missing: shared/run.sh',
      'content: shared/spec.md',
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('production seed carries the high-risk measurement and Codex multi-file invariants', () => {
  const projection = buildProjection()
  const text = (path) => projection.get(path)?.content.toString('utf8') ?? ''

  assert.ok(text('core/spec.md').includes('DYNAMIC scenario'))
  assert.ok(text('core/spec.md').includes('`codeSha` anchors to HEAD'))
  assert.ok(text('prompts/reproduce-before-fix/spec.md').includes('fix, verify, commit, then file (pass)'))
  assert.ok(text('prompts/reproduce-before-fix/spec.md').includes('`codeSha` names the very commit you measured'))
  assert.ok(text('core/spec-first/spec-first.sh').includes('multi-file apply_patch yields several paths'))
  assert.ok(text('core/spec-first/spec-first.sh').includes('ANY resolved path'))
  assert.ok(text('core/spec-of-file/spec-of-file.sh').includes('multi-file apply_patch yields several paths'))
  assert.ok(text('core/spec-of-file/spec-of-file.sh').includes('annotate EACH governed code file'))
  assert.ok(!projection.has('prompts/deploy-runbook/spec.md'), 'SpexCode fleet runbook is an explicit holdback')
  assert.ok(!projection.has('skills/taste/spec.md'), 'SpexCode engineering taste is an explicit holdback')
  assert.ok(!projection.has('review/spec.md'), 'review presets remain an explicit live-only holdback')
  assert.ok(!projection.has('skills/e2e-review/spec.md'), 'e2e-review remains an explicit live-only holdback')
  assert.ok(!projection.has('core/mark-active/eval.md'), 'dogfood hook scenarios remain explicit holdbacks')
  assert.ok(!projection.has('core/stop-gate/eval.md'), 'dogfood hook scenarios remain explicit holdbacks')
  assert.deepEqual(projectionDiff(projection), [], 'the checked-in production seed is the current projection')
})

test('Codex multi-file hooks consider every path in one mutation', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-multi-file-hooks-'))
  const store = join(fixture, 'store')
  const lib = join(fixture, 'harness.sh')
  const owner = join(fixture, 'owner.sh')
  try {
    write(lib, [
      'hp_session_id() { printf session; }',
      'hp_store_dir() { printf %s "$HOOK_STORE"; }',
      'hp_code_path() { printf \'%s\\n\' "$HOOK_PATHS"; }',
      '',
    ].join('\n'))
    const env = {
      ...process.env,
      SPEXCODE_HARNESS_LIB: lib,
      HOOK_STORE: store,
      HOOK_PATHS: '.spec/project/spec.md\nsrc/a.ts',
    }
    const first = execFileSync('bash', [join(LIVE_PLUGINS, 'core', 'spec-first', 'spec-first.sh')], {
      cwd: fixture,
      env,
      input: '{}',
      encoding: 'utf8',
    })
    assert.match(first, /"decision":"block"/, 'one non-spec path makes the whole multi-file access actionable')

    execFileSync('git', ['init', '-q'], { cwd: fixture })
    write(join(fixture, 'src', 'a.ts'), 'a\n')
    write(join(fixture, 'src', 'b.ts'), 'b\n')
    write(owner, '#!/bin/sh\nprintf "owner:%s" "$3"\n', 0o755)
    const annotate = execFileSync('bash', [join(LIVE_PLUGINS, 'core', 'spec-of-file', 'spec-of-file.sh')], {
      cwd: fixture,
      env: { ...env, HOOK_PATHS: 'src/a.ts\nsrc/b.ts', SPEX: owner },
      input: '{}',
      encoding: 'utf8',
    })
    assert.match(annotate, /owner:src\/a\.ts\\nowner:src\/b\.ts/)
    assert.equal(readFileSync(join(store, 'spec-of-file-seen'), 'utf8'), 'src/a.ts\nsrc/b.ts\n')
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
