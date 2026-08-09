import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fromForge } from './issues.js'

test('fromForge preserves platform labels and their display colors on the unified Issue', () => {
  const [issue] = fromForge({
    host: 'gitlab',
    state: {
      issues: [{
        number: 42,
        title: 'Retain platform labels',
        body: '',
        url: 'https://gitlab.example/acme/spex/-/issues/42',
        state: 'open',
        labels: [
          { name: 'bug', color: '#d73a4a', textColor: '#ffffff' },
          { name: 'triage' },
        ],
        author: 'octavia',
        createdAt: '2026-08-09T00:00:00Z',
        comments: [],
      }],
      prs: [],
    },
  }, [])

  assert.deepEqual(issue.labels, [
    { name: 'bug', color: '#d73a4a', textColor: '#ffffff' },
    { name: 'triage' },
  ])
})
