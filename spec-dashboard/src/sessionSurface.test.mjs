import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  SESSION_SURFACE_CONVERSATION,
  SESSION_SURFACE_TERMINAL,
  getDefaultSessionSurface,
  getSessionBaseSurface,
  hasSessionBaseSurface,
  sessionSurfaceStorageKey,
  setDefaultSessionSurface,
  setSessionBaseSurface,
  subscribeSessionSurface,
} from './sessionSurface.js'

const settings = readFileSync(new URL('./Settings.jsx', import.meta.url), 'utf8')

function storage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

test('session base surfaces persist explicit choices without overriding the default', () => {
  const previous = globalThis.localStorage
  globalThis.localStorage = storage()
  const key = sessionSurfaceStorageKey()
  try {
    assert.match(key, /^spexcode\.session-surface\.v1\./)
    assert.equal(getDefaultSessionSurface(), SESSION_SURFACE_TERMINAL)
    assert.equal(getSessionBaseSurface('alpha'), SESSION_SURFACE_TERMINAL)
    assert.equal(hasSessionBaseSurface('alpha'), false)

    setDefaultSessionSurface(SESSION_SURFACE_CONVERSATION)
    assert.equal(getSessionBaseSurface('alpha'), SESSION_SURFACE_CONVERSATION)
    setSessionBaseSurface('alpha', SESSION_SURFACE_TERMINAL)
    assert.equal(hasSessionBaseSurface('alpha'), true)
    setDefaultSessionSurface(SESSION_SURFACE_CONVERSATION)
    assert.equal(getSessionBaseSurface('alpha'), SESSION_SURFACE_TERMINAL)
    assert.equal(getSessionBaseSurface('bravo'), SESSION_SURFACE_CONVERSATION)
    assert.deepEqual(JSON.parse(globalThis.localStorage.getItem(key)), {
      defaultSurface: SESSION_SURFACE_CONVERSATION,
      sessions: { alpha: SESSION_SURFACE_TERMINAL },
    })
  } finally {
    if (previous === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previous
  }
})

test('session surface writes publish immediately', () => {
  const seen = []
  const unsubscribe = subscribeSessionSurface((state) => seen.push(state))
  try {
    setSessionBaseSurface('charlie', SESSION_SURFACE_CONVERSATION)
  } finally {
    unsubscribe()
  }
  assert.equal(seen.at(-1)?.sessions.charlie, SESSION_SURFACE_CONVERSATION)
})

test('Settings exposes the default surface as a segmented preference', () => {
  assert.match(settings, /getDefaultSessionSurface/)
  assert.match(settings, /setDefaultSessionSurface/)
  assert.match(settings, /className="set-terminal-surface"/)
  assert.match(settings, /SESSION_SURFACE_TERMINAL/)
  assert.match(settings, /SESSION_SURFACE_CONVERSATION/)
})
