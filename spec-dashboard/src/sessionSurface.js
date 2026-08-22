import { PROJECT_ID } from './project.js'

export const SESSION_SURFACE_TERMINAL = 'terminal'
export const SESSION_SURFACE_CONVERSATION = 'conversation'
export const SESSION_SURFACE_DIFF = 'diff'

const STORAGE_PREFIX = 'spexcode.session-surface.v1'
const SURFACES = new Set([SESSION_SURFACE_TERMINAL, SESSION_SURFACE_CONVERSATION, SESSION_SURFACE_DIFF])
const listeners = new Set()
let memoryState = null

export const sessionSurfaceStorageKey = (projectId = PROJECT_ID) => `${STORAGE_PREFIX}.${projectId || 'root'}`

const emptyState = () => ({ defaultSurface: SESSION_SURFACE_TERMINAL, sessions: {} })
const validSurface = (value) => SURFACES.has(value)
export const isSessionSurface = validSurface

function normalizeState(value) {
  const state = emptyState()
  if (!value || typeof value !== 'object') return state
  if (validSurface(value.defaultSurface)) state.defaultSurface = value.defaultSurface
  if (value.sessions && typeof value.sessions === 'object' && !Array.isArray(value.sessions)) {
    state.sessions = Object.fromEntries(Object.entries(value.sessions).filter(([, surface]) => validSurface(surface)))
  }
  return state
}

function readState() {
  try {
    const saved = localStorage.getItem(sessionSurfaceStorageKey())
    return saved ? normalizeState(JSON.parse(saved)) : emptyState()
  } catch {
    return memoryState || emptyState()
  }
}

function writeState(state) {
  memoryState = state
  try { localStorage.setItem(sessionSurfaceStorageKey(), JSON.stringify(state)) } catch { /* live browser memory remains usable */ }
  for (const listener of listeners) listener(state)
  return state
}

function requireSurface(surface) {
  if (!validSurface(surface)) throw new Error(`Invalid session surface: ${surface}`)
  return surface
}

export function getDefaultSessionSurface() {
  return readState().defaultSurface
}

export function getSessionBaseSurface(sessionId) {
  const state = readState()
  return state.sessions[sessionId] || state.defaultSurface
}

export function hasSessionBaseSurface(sessionId) {
  return Object.hasOwn(readState().sessions, sessionId)
}

export function setDefaultSessionSurface(surface) {
  const state = readState()
  return writeState({ ...state, defaultSurface: requireSurface(surface) }).defaultSurface
}

export function setSessionBaseSurface(sessionId, surface) {
  if (!sessionId) throw new Error('A session id is required to set its base surface')
  const state = readState()
  return writeState({ ...state, sessions: { ...state.sessions, [sessionId]: requireSurface(surface) } }).sessions[sessionId]
}

export function subscribeSessionSurface(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
