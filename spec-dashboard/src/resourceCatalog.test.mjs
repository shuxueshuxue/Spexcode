import test from 'node:test'
import assert from 'node:assert/strict'
import { ALL_FILTER, RESOURCE_TYPES, UPLOADED_FILTER, fileType, matchResources, resourceCatalog, resourceFilters } from './resourceCatalog.js'

const session = {
  id: 's1',
  files: [
    '/work/reports/review.html',
    '/work/notes.md',
    '/work/a/summary.txt',
    '/work/b/summary.txt',
    '/work/bundle.qzx9',
    '/tmp/spexcode-uploads/mtx5-0d1ed42a-dbb3-4bfd-89ed-9ac03c142d90-mockup.png',
  ],
  uploadedFiles: [{ path: '/tmp/spexcode-uploads/mtx5-0d1ed42a-dbb3-4bfd-89ed-9ac03c142d90-mockup.png', name: 'mockup.png', uploadedAt: 1789142889903 }],
  web: [{ key: 'w1', url: 'http://127.0.0.1:4173/deck' }],
}

test('the catalog lists files newest first, then web services, each with the id a resource tab keys on', () => {
  const entries = resourceCatalog(session)
  assert.deepEqual(entries.map((entry) => entry.label), ['mockup.png', 'bundle.qzx9', 'summary.txt', 'summary.txt', 'notes.md', 'review.html', '127.0.0.1:4173/deck'])
  assert.equal(entries[0].id, 's1:file:/tmp/spexcode-uploads/mtx5-0d1ed42a-dbb3-4bfd-89ed-9ac03c142d90-mockup.png')
  assert.equal(entries.at(-1).id, 's1:web:w1')
  assert.deepEqual(resourceCatalog(null), [])
})

test('an upload wears the name the human gave it and its time; an agent file does not', () => {
  const [upload, ...rest] = resourceCatalog(session)
  assert.deepEqual({ label: upload.label, type: upload.type, uploadedAt: upload.uploadedAt, folder: upload.folder }, { label: 'mockup.png', type: 'image', uploadedAt: 1789142889903, folder: '' })
  assert.ok(rest.every((entry) => entry.uploadedAt === null))
})

test('a folder is named only where two posted files share a name', () => {
  const folders = Object.fromEntries(resourceCatalog(session).filter((entry) => entry.kind === 'file').map((entry) => [entry.value, entry.folder]))
  assert.deepEqual(folders, {
    '/tmp/spexcode-uploads/mtx5-0d1ed42a-dbb3-4bfd-89ed-9ac03c142d90-mockup.png': '',
    '/work/bundle.qzx9': '',
    '/work/b/summary.txt': 'b',
    '/work/a/summary.txt': 'a',
    '/work/notes.md': '',
    '/work/reports/review.html': '',
  })
})

test('the chip vocabulary is closed: only allowlisted types that are present, in fixed order, then Uploaded', () => {
  assert.equal(fileType('bundle.qzx9'), null)
  assert.equal(fileType('Photo.JPEG'), 'image')
  assert.equal(fileType('archive.tar.gz'), 'archive')
  const filters = resourceFilters(resourceCatalog(session))
  assert.deepEqual(filters, [
    { id: ALL_FILTER, count: 7 },
    { id: 'html', count: 1 },
    { id: 'markdown', count: 1 },
    { id: 'image', count: 1 },
    { id: 'text', count: 2 },
    { id: 'web', count: 1 },
    { id: UPLOADED_FILTER, count: 1 },
  ])
  const allowed = new Set(RESOURCE_TYPES.map((type) => type.id))
  assert.ok(filters.every((chip) => chip.id === ALL_FILTER || chip.id === UPLOADED_FILTER || allowed.has(chip.id)))
  assert.deepEqual(resourceFilters(resourceCatalog({ id: 's2', files: ['/x/a.qzx9', '/x/b.weird'] })), [{ id: ALL_FILTER, count: 2 }])
})

test('a filter and a name search narrow the same list, and an unknown suffix stays under All only', () => {
  const entries = resourceCatalog(session)
  const labels = (options) => matchResources(entries, options).map((entry) => entry.label)
  assert.ok(labels({ filter: ALL_FILTER }).includes('bundle.qzx9'))
  assert.deepEqual(labels({ filter: 'text' }), ['summary.txt', 'summary.txt'])
  assert.deepEqual(labels({ filter: UPLOADED_FILTER }), ['mockup.png'])
  assert.deepEqual(labels({ filter: ALL_FILTER, query: '  REV ' }), ['review.html'])
  assert.deepEqual(labels({ filter: 'image', query: 'summary' }), [])
})
