'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { hubNoticeUrl, mapDeepLink } = require('./deep-link.js')

test('maps a canonical deep link onto the gateway origin', () => {
  assert.deepEqual(
    mapDeepLink('spexcode://p/project-a/#/spec/node%20one', 'http://127.0.0.1:5521/path', new Set(['project-a'])),
    {
      ok: true,
      projectId: 'project-a',
      address: '#/spec/node%20one',
      url: 'http://127.0.0.1:5521/p/project-a/#/spec/node%20one',
    },
  )
})

test('preserves the dashboard query inside the hash address', () => {
  const result = mapDeepLink(
    'spexcode://p/project-a/#/evals?q=is%3Aeval%20state%3Acurrent',
    'http://localhost:5173',
    new Set(['project-a']),
  )
  assert.equal(result.ok, true)
  assert.equal(result.url, 'http://localhost:5173/p/project-a/#/evals?q=is%3Aeval%20state%3Acurrent')
})

test('rejects unknown projects and malformed dashboard addresses with a reason', () => {
  assert.deepEqual(
    mapDeepLink('spexcode://p/missing/#/sessions/abc', 'http://127.0.0.1:5173', new Set(['known'])),
    { ok: false, reason: "Unknown project 'missing'." },
  )
  assert.match(mapDeepLink('spexcode://p/known/sessions/abc', 'http://127.0.0.1:5173', new Set(['known'])).reason, /expected/)
  assert.match(mapDeepLink('spexcode://p/known/#/not-a-page', 'http://127.0.0.1:5173', new Set(['known'])).reason, /unknown dashboard page/)
  assert.match(mapDeepLink('https://p/known/#/sessions/abc', 'http://127.0.0.1:5173', new Set(['known'])).reason, /scheme/)
})

test('builds the projects-hub notice URL without changing the origin', () => {
  assert.equal(
    hubNoticeUrl('http://127.0.0.1:5173/ignored', "Unknown project 'missing'."),
    'http://127.0.0.1:5173/projects?notice=Unknown+project+%27missing%27.',
  )
})
