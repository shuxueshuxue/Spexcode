import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProjectPath, scopedApiUrl, projectHref, hubHref, legacyProjectsRedirect } from './project.js'
import { PAGES, parseRoute } from './route.js'

// The project-scope seam ([[projects-hub]] / [[dashboard-shell]]): the pathname is the WHOLE scope
// contract — these tests pin the parse, the URL prefixing, and the cross-scope hrefs, because every
// backend call in the app rides them.

test('parseProjectPath: only /p/<id> paths carry a scope', () => {
  assert.deepEqual(parseProjectPath('/'), { id: null, base: '' })
  assert.deepEqual(parseProjectPath(''), { id: null, base: '' })
  assert.deepEqual(parseProjectPath('/index.html'), { id: null, base: '' })
  assert.deepEqual(parseProjectPath('/px/abc'), { id: null, base: '' })
  assert.deepEqual(parseProjectPath('/p/'), { id: null, base: '' })
  assert.deepEqual(parseProjectPath('/p/abc'), { id: 'abc', base: '/p/abc' })
  assert.deepEqual(parseProjectPath('/p/abc/'), { id: 'abc', base: '/p/abc' })
  assert.deepEqual(parseProjectPath('/p/abc/deep/route'), { id: 'abc', base: '/p/abc' })
})

test('parseProjectPath: the id is decoded for use, the base keeps the raw served segment', () => {
  const r = parseProjectPath('/p/my%20proj/')
  assert.equal(r.id, 'my proj')
  assert.equal(r.base, '/p/my%20proj')
  // a malformed escape must not throw — the raw segment stands in
  const bad = parseProjectPath('/p/bad%zz/')
  assert.equal(bad.id, 'bad%zz')
  assert.equal(bad.base, '/p/bad%zz')
})

test('scopedApiUrl prefixes exactly the /api lane, idempotently', () => {
  assert.equal(scopedApiUrl('/api/graph', '/p/x'), '/p/x/api/graph')
  assert.equal(scopedApiUrl('/api/sessions/a/socket', '/p/x'), '/p/x/api/sessions/a/socket')
  assert.equal(scopedApiUrl('/api/graph', ''), '/api/graph')                    // unscoped page: byte-identical
  assert.equal(scopedApiUrl('/projects', '/p/x'), '/projects')                  // the catalog stays root-scoped
  assert.equal(scopedApiUrl('https://cdn.example/x.svg', '/p/x'), 'https://cdn.example/x.svg')
  // double application must not double-prefix (apiFetch may see an already-built sessionUrl)
  assert.equal(scopedApiUrl(scopedApiUrl('/api/graph', '/p/x'), '/p/x'), '/p/x/api/graph')
})

test('cross-scope hrefs land on their canonical project and global surfaces', () => {
  assert.equal(projectHref('abc'), '/p/abc/#/graph')
  assert.equal(projectHref('a b', '#/sessions'), '/p/a%20b/#/sessions')
  assert.equal(hubHref(), '/projects')
})

test('project navigation contains only project-owned pages', () => {
  assert.deepEqual(PAGES, ['graph', 'sessions', 'evals', 'issues', 'settings'])
  assert.deepEqual(parseRoute('#/projects'), { page: 'graph', param: null, query: {} })
  assert.equal(parseRoute('#/nonsense').page, 'graph') // unknown still lands home
})

test('the retired scoped projects hash redirects once to the global surface', () => {
  assert.equal(legacyProjectsRedirect('/p/abc/', '#/projects'), '/projects')
  assert.equal(legacyProjectsRedirect('/p/a%20b/', '#/projects?from=old'), '/projects')
  assert.equal(legacyProjectsRedirect('/projects', '#/projects'), null)
  assert.equal(legacyProjectsRedirect('/p/abc/', '#/graph'), null)
})
