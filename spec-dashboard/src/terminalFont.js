const STORAGE_KEY = 'spexcode.terminal-font-size'

export const TERMINAL_FONT_MIN = 9
export const TERMINAL_FONT_MAX = 18
export const TERMINAL_FONT_STEP = 1

const listeners = new Set()

function defaultFontSize() {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--type-terminal'))
  if (!Number.isFinite(value)) throw new Error('Terminal font-size token is missing or invalid')
  return value
}

function validFontSize(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= TERMINAL_FONT_MIN && number <= TERMINAL_FONT_MAX
    ? Math.round(number / TERMINAL_FONT_STEP) * TERMINAL_FONT_STEP
    : null
}

export function getTerminalFontSize() {
  let saved = null
  try { saved = validFontSize(localStorage.getItem(STORAGE_KEY)) } catch { /* browser storage is optional */ }
  return saved ?? defaultFontSize()
}

export function setTerminalFontSize(value) {
  const fontSize = validFontSize(value)
  if (fontSize === null) throw new Error(`Invalid terminal font size: ${value}`)
  try { localStorage.setItem(STORAGE_KEY, String(fontSize)) } catch { /* keep the live preference */ }
  for (const listener of listeners) listener(fontSize)
  return fontSize
}

export function subscribeTerminalFontSize(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
