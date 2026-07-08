import { keyCap } from './keymap.js'

export function showLockCycleKeys(count) {
  return count > 1
}

export function lockCycleKeyLabels(keysFor) {
  return {
    next: keyCap((keysFor('board.cycle') || [])[0] || 'o'),
    prev: keyCap((keysFor('board.cycleRev') || [])[0] || 'O'),
  }
}
