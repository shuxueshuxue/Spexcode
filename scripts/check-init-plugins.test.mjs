import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { LIVE_PLUGINS, INIT_PLUGINS, diffAgainst, initPluginDifferences, seedFiles } from './check-init-plugins.mjs'

function write(path, content, mode = 0o644) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  chmodSync(path, mode)
}

test('the checker states the rule between the two tracked copies, and names every way they break it', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-init-plugins-'))
  const specRoot = join(root, '.spec', 'spexcode')
  const plugins = join(specRoot, '.plugins')
  const seed = join(root, 'template', '.plugins')
  const check = () => initPluginDifferences({ sourceDir: plugins, targetDir: seed, specRoot })
  try {
    // a node OUTSIDE the plugin tree: known to this repository, never shipped — so a link to it is refused
    write(join(specRoot, 'outside', 'spec.md'), '---\ntitle: outside\n---\noutside\n')
    write(join(plugins, 'spec.md'), '---\ntitle: .plugins\n---\nroot\n')
    write(join(plugins, 'shared', 'spec.md'), [
      '---', 'title: shared', 'seed: true', '---',
      'keep [[shared]], teach `[[outside]]`.',
      'path: .spec/spexcode/.plugins/shared/run.sh', '',
    ].join('\n'))
    write(join(plugins, 'shared', 'run.sh'), '#!/bin/sh\n', 0o755)
    write(join(plugins, 'held', 'spec.md'), '---\ntitle: held\nseed: false\n---\nheld\n')
    write(join(plugins, 'held', 'secret.txt'), 'secret\n')

    // the seed a person writes by hand: the same words, its own spec root, no `seed:` line, no held-back node
    write(join(seed, 'spec.md'), '---\ntitle: .plugins\n---\nroot\n')
    write(join(seed, 'shared', 'spec.md'), [
      '---', 'title: shared', '---',
      'keep [[shared]], teach `[[outside]]`.',
      'path: .spec/project/.plugins/shared/run.sh', '',
    ].join('\n'))
    write(join(seed, 'shared', 'run.sh'), '#!/bin/sh\n', 0o755)
    assert.deepEqual(check(), [], 'the rule holds: same words, its own root, no seed: line, held-back node absent')

    chmodSync(join(seed, 'shared', 'run.sh'), 0o644)
    assert.deepEqual(check(), ['mode: shared/run.sh'], 'an executable helper that lost its bit is a difference')
    chmodSync(join(seed, 'shared', 'run.sh'), 0o755)

    writeFileSync(join(seed, 'shared', 'spec.md'), 'one-sided edit\n')
    rmSync(join(seed, 'shared', 'run.sh'))
    write(join(seed, 'extra.txt'), 'extra\n')
    assert.deepEqual(check(), [
      'extra in the seed: extra.txt',
      'missing from the seed: shared/run.sh',
      'content: shared/spec.md',
    ])
    rmSync(join(seed, 'extra.txt'))
    write(join(seed, 'shared', 'run.sh'), '#!/bin/sh\n', 0o755)

    // a link to a node the seed does not ship is REFUSED, not rewritten — an adopter would see a dangling
    // mention in a node they never wrote. A link inside backticks is the syntax being taught, and stays.
    const linked = ['---', 'title: shared', 'seed: true', '---',
      'keep [[shared]], teach `[[outside]]`, but [[outside]] bare is refused.',
      'path: .spec/spexcode/.plugins/shared/run.sh', ''].join('\n')
    writeFileSync(join(plugins, 'shared', 'spec.md'), linked)
    writeFileSync(join(seed, 'shared', 'spec.md'), linked.replace('.spec/spexcode/', '.spec/project/').replace('seed: true\n', ''))
    assert.deepEqual(check().filter((d) => d.startsWith('link:')),
      ['link: shared/spec.md names [[outside]], which the seed does not ship — write it as plain text'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('production seed carries the high-risk measurement and Codex multi-file invariants', () => {
  const projection = seedFiles()
  const text = (path) => projection.get(path)?.content.toString('utf8') ?? ''

  const core = text('core/spec.md')
  assert.ok(core.split(/\s+/).filter(Boolean).length <= 240, 'the always-on contract stays a compact invariant set')
  assert.match(core, /`spex help` is the authoritative command map/i)
  assert.match(core, /spex spec lint.*blocking correctness gate/i)
  assert.doesNotMatch(core, /measurement ledger/i)
  const repair = text('prompts/reproduce-before-fix/spec.md')
  assert.match(repair, /one scenario[\s\S]*?fail→pass pair[\s\S]*?repair proof/i)
  assert.match(repair, /new intent has no prior failure to[\s\S]*?reproduce/i)
  assert.match(repair, /real product/)
  assert.doesNotMatch(repair, /A, before editing/i)
  const comments = text('core/comment-altitude/spec.md')
  assert.match(comments, /Specs own intent.*Comments only navigate non-obvious local decisions/s)
  assert.match(comments, /spex guide spec/)
  assert.doesNotMatch(comments, /Keep a short nearby comment/)
  const landing = text('prompts/atomic-landing/spec.md')
  assert.match(landing, /merge `<base>` into the branch/)
  assert.match(landing, /git merge-base --is-ancestor/)
  assert.match(landing, /synced branch's verification is required/)
  assert.match(landing, /spex guide spec/)
  assert.doesNotMatch(landing, /shared checkout is mid-merge/)
  assert.ok(text('core/spec-first/spec-first.sh').includes('while IFS= read -r candidate'))
  assert.ok(text('core/spec-first/spec-first.sh').includes('spec-governors "$candidate"'))
  assert.ok(text('core/spec-of-file/spec-of-file.sh').includes('multi-file apply_patch yields several paths'))
  assert.ok(text('core/spec-of-file/spec-of-file.sh').includes('annotate EACH governed code file'))
  assert.ok(!projection.has('prompts/deploy-runbook/spec.md'), 'SpexCode fleet runbook is an explicit holdback')
  assert.ok(!projection.has('skills/taste/spec.md'), 'SpexCode engineering taste is an explicit holdback')
  assert.ok(!projection.has('review/spec.md'), 'review presets remain an explicit live-only holdback')
  assert.ok(!projection.has('skills/e2e-review/spec.md'), 'retired recording review skill is absent')
  assert.deepEqual(initPluginDifferences(), [], 'the checked-in seed still satisfies the rule')
})

test('Codex multi-file hooks consider every path in one payload', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-multi-file-hooks-'))
  const store = join(fixture, 'store')
  const lib = join(fixture, 'harness.sh')
  const owner = join(fixture, 'owner.sh')
  try {
    write(lib, [
      'hp_session_id() { printf session; }',
      'hp_store_dir() { printf %s "$HOOK_STORE"; }',
      'hp_code_path() { printf \'%s\\n\' "$HOOK_PATHS"; }',
      'hp_profile_hook_enabled() { return 0; }',
      '',
    ].join('\n'))
    execFileSync('git', ['init', '-q'], { cwd: fixture })
    write(join(fixture, 'src', 'a.ts'), 'a\n')
    write(join(fixture, 'src', 'b.ts'), 'b\n')
    write(owner, [
      '#!/bin/sh',
      'if [ "$1" = internal ] && [ "$2" = spec-governors ]; then',
      '  [ "$3" = src/a.ts ] && printf \'a\\t.spec/project/a/spec.md\\n\'',
      '  exit 0',
      'fi',
      'if [ "$1" = internal ] && [ "$2" = hook-prompt ]; then',
      '  if [ "$4" = --details ]; then printf \'owner:src/a.ts\\nowner:src/b.ts\'; else printf \'read .spec/project/a/spec.md\'; fi',
      '  exit 0',
      'fi',
      'printf "owner:%s" "$3"',
      '',
    ].join('\n'), 0o755)
    const env = {
      ...process.env,
      SPEXCODE_HARNESS_LIB: lib,
      SPEX: owner,
      HOOK_STORE: store,
      HOOK_PATHS: 'src/ungoverned.ts\nsrc/a.ts',
    }
    const first = execFileSync('bash', [join(LIVE_PLUGINS, 'core', 'spec-first', 'spec-first.sh')], {
      cwd: fixture,
      env,
      input: '{}',
      encoding: 'utf8',
    })
    assert.match(first, /"decision":"block"/, 'a later governed path makes the multi-file read actionable')
    assert.match(first, /\.spec\/project\/a\/spec\.md/)

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
