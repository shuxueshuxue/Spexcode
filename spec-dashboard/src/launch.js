import { useCallback, useEffect, useState } from 'react'
import { loadPlugins, loadSettings } from './data.js'
import { apiUrl } from './project.js'

const pendingSessions = new Map()
export const pendingSessionFor = (id) => pendingSessions.get(id) || null

// The dashboard's ONE session-launch CLIENT path, shared by every face that can start a worker — the desktop
// console's New Session tab (SessionInterface.jsx) and the phone's composer (MobileApp.jsx). Launcher state,
// preset discovery, and the raw create POST live here. The backend prompt boundary owns command expansion for
// launch and send, shared with CLI/API callers; browser clients never expand plugin bodies.

// launch a session: the one POST /api/sessions. A launcher SUBSUMES the harness ([[launcher-select]]):
// send only the chosen launcher name; the backend derives harness from that profile. No launcher yet
// (picker not loaded) means the backend uses its default. The per-attempt idempotency key makes a lost response
// recoverable without changing the prompt body contract. Returns the created session projection when the
// backend publishes one, so the caller can open the document as soon as creation is acknowledged.
export async function createSession(prompt, launcher) {
  try {
    const requestKey = globalThis.crypto?.randomUUID?.() || `session-create-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const res = await fetch(apiUrl('/api/sessions'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey },
      body: JSON.stringify({ prompt, ...(launcher ? { launcher } : {}) }),
    })
    const body = await res.json().catch(() => null)
    const result = { ok: res.ok, error: body?.error }
    if (body?.id) {
      pendingSessions.set(body.id, body)
      result.id = body.id
      result.session = body
    }
    return result
  } catch {
    return { ok: false }
  }
}

// One settings read shared by every launcher consumer. The New Session composer and its picker can mount at
// different times; a module snapshot lets a later consumer inherit loaded profiles synchronously, while the
// one in-flight promise removes duplicate settings reads.
let launcherSettings = null
let launcherSettingsRequest = null
const loadLauncherSettings = () => {
  if (launcherSettings) return Promise.resolve(launcherSettings)
  if (!launcherSettingsRequest) {
    launcherSettingsRequest = loadSettings().then((d) => {
      launcherSettings = d
      return d
    }).catch((e) => {
      launcherSettingsRequest = null
      throw e
    })
  }
  return launcherSettingsRequest
}

// A missing field means an older backend and lets an already-loaded value survive; an explicit empty
// array is authoritative and must clear stale UI state after a config change.
const launcherListFrom = (d) => Array.isArray(d?.launchers) ? d.launchers : null
// zcode is a backend-only adapter for the external zswarm integration. Keep it available to
// materialize/session records, but do not offer it as a dashboard launch choice.
export const isDashboardVisibleHarness = (id) => typeof id !== 'string' || id.trim() !== 'zcode'
const dashboardLauncherListFrom = (d) => {
  const list = launcherListFrom(d)
  return list ? list.filter((entry) => isDashboardVisibleHarness(entry?.harness)) : null
}
const harnessTargetListFrom = (d) => Array.isArray(d?.harnessTargets)
  ? d.harnessTargets.filter((id) => typeof id === 'string' && id.trim() && isDashboardVisibleHarness(id)).map((id) => id.trim())
  : null
const rememberedLauncher = () => { try { return localStorage.getItem('si.launcher') || '' } catch { return '' } }
const initialLauncher = (list, configuredDefault, remembered = rememberedLauncher()) => {
  if (list.some((l) => l.name === remembered)) return remembered
  if (configuredDefault && list.some((l) => l.name === configuredDefault)) return configuredDefault
  return list[0]?.name || ''
}

// the configured launcher profiles ([[launcher-select]]) + the current pick. The pick is remembered
// per-browser under the ONE key every surface shares, so phone and desktop agree on it. Initial selection
// honors the config default: remembered pick (if still configured) → configured `default` → first row. The
// list is the complete configured registry — headless launchers are ordinary rows, not a hidden tier.
export function useLaunchers() {
  const cached = dashboardLauncherListFrom(launcherSettings) || []
  const [launchers, setLaunchers] = useState(cached)
  const [launcher, setLauncher] = useState(() => initialLauncher(cached, launcherSettings?.default))
  const [harnessTargets, setHarnessTargets] = useState(() => harnessTargetListFrom(launcherSettings) || [])
  const pickLauncher = (name) => { setLauncher(name); try { localStorage.setItem('si.launcher', name) } catch {} }
  const applySettings = useCallback((d, current = null) => {
    const list = dashboardLauncherListFrom(d)
    if (list) {
      setLaunchers(list)
      setLauncher((cur) => initialLauncher(list, d.default, current ?? cur))
    }
    const targets = harnessTargetListFrom(d)
    if (targets) setHarnessTargets(targets)
    launcherSettings = d
    return { list: list || [], targets: targets || [] }
  }, [])
  useEffect(() => {
    loadLauncherSettings().then((d) => {
      applySettings(d)
    }).catch(() => {})
  }, [applySettings])
  // A successful host-side harness addition invalidates the module snapshot and refreshes this picker in
  // place. Other consumers that mount later inherit the same fresh snapshot synchronously.
  const refreshLaunchers = useCallback(async () => {
    launcherSettings = null
    launcherSettingsRequest = null
    const d = await loadLauncherSettings()
    applySettings(d)
    return d
  }, [applySettings])
  return { launchers, launcher, pickLauncher, harnessTargets, refreshLaunchers }
}

// the command presets (GET /api/plugins) — shared by the launch box and Command Box `/` palettes. The route
// returns only command-surface nodes, so the list IS the invocable set — no client filter.
export function useCommandPresets() {
  const [presets, setPresets] = useState([])
  useEffect(() => {
    loadPlugins().then((d) => { if (Array.isArray(d)) setPresets(d) }).catch(() => {})
  }, [])
  return presets
}

// the harness's own `/` commands (GET /api/slash-commands?harness=…) — the SAME list that harness's TUI shows,
// recomputed when the session's harness differs (a codex session gets codex's menu, a claude session
// claude's). Display + insert only; never executed here. Shared by the Command Box and the Conversation
// composer so both `/` palettes are one vocabulary ([[command-box]]).
export function useHarnessCommands(harness) {
  const [commands, setCommands] = useState([])
  useEffect(() => {
    let live = true
    fetch(apiUrl(`/api/slash-commands?harness=${encodeURIComponent(harness || 'claude')}`))
      .then((r) => r.json())
      .then((d) => { if (live && Array.isArray(d)) setCommands(d) })
      .catch(() => {})
    return () => { live = false }
  }, [harness])
  return commands
}
