import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { SessionTerminal } from './index.js'

test('terminal UI exports a React host without transport coupling', () => {
  assert.equal(typeof SessionTerminal, 'function')
  const html = renderToStaticMarkup(createElement(SessionTerminal, { sessionId: 'demo', transport: { connect() { throw new Error('browser-only') } } }))
  assert.match(html, /st-wrap/)
})
