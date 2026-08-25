import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDiffTree, treeDirKeys, splitPath } from './diffTree.js'

const file = (path, extra = {}) => ({ path, status: 'modified', additions: 1, deletions: 0, ...extra })

// The shape this panel exists for: a spec tree where the leaf name carries no information at all.
test('a single-child directory chain collapses into one row so the leaf is not pushed off the panel', () => {
  const tree = buildDiffTree([
    file('.spec/spexcode/spec-cli/sessions/sessions-core/spec.md'),
    file('.spec/spexcode/spec-cli/sessions/sessions-core/eval.md'),
  ])
  assert.equal(tree.length, 1)
  assert.equal(tree[0].kind, 'dir')
  assert.equal(tree[0].name, '.spec/spexcode/spec-cli/sessions/sessions-core')
  assert.deepEqual(tree[0].children.map((c) => c.name), ['eval.md', 'spec.md'])
})

test('a chain stops collapsing where it actually branches', () => {
  const tree = buildDiffTree([
    file('.spec/spexcode/spec-cli/sessions/sessions-core/spec.md'),
    file('.spec/spexcode/spec-cli/sessions/live-view/spec.md'),
  ])
  assert.deepEqual(tree.map((c) => c.name), ['.spec/spexcode/spec-cli/sessions'])
  assert.deepEqual(tree[0].children.map((c) => c.name), ['live-view', 'sessions-core'])
  // and each branch collapses its own remaining chain
  assert.deepEqual(tree[0].children[0].children.map((c) => c.name), ['spec.md'])
})

test('a directory holding both a file and a subdirectory does not collapse past itself', () => {
  const tree = buildDiffTree([file('pkg/index.ts'), file('pkg/inner/deep.ts')])
  assert.deepEqual(tree.map((c) => c.name), ['pkg'])
  assert.deepEqual(tree[0].children.map((c) => `${c.kind}:${c.name}`), ['dir:inner', 'file:index.ts'])
})

test('directories sort before files and each group sorts by name', () => {
  const tree = buildDiffTree([file('a/z.ts'), file('a/b.ts'), file('a/m/one.ts')])
  assert.deepEqual(tree[0].children.map((c) => `${c.kind}:${c.name}`), ['dir:m', 'file:b.ts', 'file:z.ts'])
})

test('a root-level file is its own row with no directory above it', () => {
  const tree = buildDiffTree([file('README.md')])
  assert.deepEqual(tree.map((c) => `${c.kind}:${c.name}`), ['file:README.md'])
})

test('a leaf carries the whole file record so the row can render status and counts', () => {
  const tree = buildDiffTree([file('a/b.ts', { status: 'untracked', additions: 36, deletions: 0 })])
  const leaf = tree[0].children[0]
  assert.equal(leaf.file.status, 'untracked')
  assert.equal(leaf.file.additions, 36)
  assert.equal(leaf.file.path, 'a/b.ts')
})

test('every directory row has a key, so the panel can open the whole tree by default', () => {
  const tree = buildDiffTree([file('a/b/c.ts'), file('a/d/e.ts')])
  assert.deepEqual(treeDirKeys(tree).sort(), ['a', 'a/b', 'a/d'].sort())
})

test('splitPath keeps the leaf whole and hands the directories back as the part that may give', () => {
  assert.deepEqual(splitPath('.spec/spexcode/spec-cli/spec.md'),
    { dir: '.spec/spexcode/spec-cli', name: 'spec.md', dirSegments: ['.spec', 'spexcode', 'spec-cli'] })
  // the segments come back as a list because the header lays them out in a reversed flex row: it is the
  // FRONT of the path that gets clipped, and that cannot be expressed on one text run
  assert.deepEqual(splitPath('README.md'), { dir: '', name: 'README.md', dirSegments: [] })
})

test('an empty list is an empty tree rather than a phantom root row', () => {
  assert.deepEqual(buildDiffTree([]), [])
})

// A tree row is identified by its label UNDER its visible ancestors, so the leaf name repeating across
// directories is correct — `spec.md` is the name every spec node's file has. What would make two rows
// genuinely indistinguishable is two SIBLINGS sharing a label, and that must never happen.
test('siblings never share a label, however often a leaf name repeats across directories', () => {
  const tree = buildDiffTree([
    file('.spec/a/spec.md'), file('.spec/a/eval.md'),
    file('.spec/b/spec.md'), file('.spec/b/eval.md'),
    file('src/spec.md'),
  ])
  const walk = (nodes) => {
    const labels = nodes.map((n) => n.name)
    assert.equal(new Set(labels).size, labels.length, `siblings share a label: ${labels.join(', ')}`)
    for (const node of nodes) if (node.kind === 'dir') walk(node.children)
  }
  walk(tree)
  // and the repetition the tree legitimately carries is still there
  const specMds = JSON.stringify(tree).match(/spec\.md/g) || []
  assert.ok(specMds.length >= 3, 'the same leaf name may appear under different directories')
})
