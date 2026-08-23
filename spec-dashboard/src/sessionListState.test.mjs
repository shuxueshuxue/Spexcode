import assert from 'node:assert/strict'
import test from 'node:test'
import {
  expandSessionFolds,
  getSessionListSnapshot,
  setSessionOfflineOpen,
  toggleSessionFold,
  useSessionListState,
} from './sessionListState.js'

test('shared session list state keeps pointer and keyboard disclosure paths in one store', () => {
  assert.equal(typeof useSessionListState, 'function')
  toggleSessionFold('parent')
  expandSessionFolds(['parent', 'ancestor'])
  setSessionOfflineOpen(true)
  const state = getSessionListSnapshot()
  assert.deepEqual([...state.expanded].sort(), ['ancestor', 'parent'])
  assert.equal(state.offlineOpen, true)
  toggleSessionFold('parent')
  toggleSessionFold('ancestor')
  setSessionOfflineOpen(false)
})
