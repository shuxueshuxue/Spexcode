import { useEffect, useState } from 'react'
import { loadPlugins, loadSettings } from './data.js'
import { apiUrl } from './project.js'

// The dashboard's ONE session-launch CLIENT path, shared by every face that can start a worker — the desktop
// console's New Session tab (SessionInterface.jsx) and the phone's composer (MobileApp.jsx). Launcher state,
// preset discovery, and the raw create POST live here. The backend prompt boundary owns command expansion for
// launch and send, shared with CLI/API callers; browser clients never expand plugin bodies.

// launch a session: the one POST /api/sessions. A launcher SUBSUMES the harness ([[launcher-select]]):
// send only the chosen launcher name; the backend derives harness from that profile. No launcher yet
// (picker not loaded) means the backend uses its default. Plain fetch, never a retrying wrapper — a retried POST could
// double-create. Returns { ok, error? }.
export async function createSession(prompt, launcher) {
  try {
    const res = await fetch(apiUrl('/api/sessions'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...(launcher ? { launcher } : {}) }),
    })
    const body = await res.json().catch(() => null)
    return { ok: res.ok, error: body?.error }
  } catch {
    return { ok: false }
  }
}

// One settings read shared by every launcher consumer. Issue/eval composers mount dynamically; making each
// start from [] and fetch independently left a real race where an immediately accepted @new became a bare
// default spawn before its launcher rows arrived. A module snapshot lets a later composer inherit the same
// already-loaded profiles synchronously, while the one in-flight promise removes duplicate settings reads.
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

const launcherListFrom = (d) => Array.isArray(d?.launchers) ? d.launchers : []
const rememberedLauncher = () => { try { return localStorage.getItem('si.launcher') || '' } catch { return '' } }
const initialLauncher = (list, configuredDefault, remembered = rememberedLauncher()) => {
  if (list.some((l) => l.name === remembered)) return remembered
  if (configuredDefault && list.some((l) => l.name === configuredDefault)) return configuredDefault
  return list[0]?.name || remembered
}

// the configured launcher profiles ([[launcher-select]]) + the current pick. The pick is remembered
// per-browser under the ONE key every surface shares, so phone and desktop agree on it. Initial selection
// honors the config default so the dashboard agrees with the CLI (`spex new` with no --launcher uses
// `defaultLauncher`): remembered pick (if still valid) → configured `default` → first.
export function useLaunchers() {
  const cached = launcherListFrom(launcherSettings)
  const [launchers, setLaunchers] = useState(cached)
  const [launcher, setLauncher] = useState(() => initialLauncher(cached, launcherSettings?.default))
  const pickLauncher = (name) => { setLauncher(name); try { localStorage.setItem('si.launcher', name) } catch {} }
  useEffect(() => {
    loadLauncherSettings().then((d) => {
      const list = launcherListFrom(d)
      if (!list.length) return
      setLaunchers(list)
      setLauncher((cur) => initialLauncher(list, d.default, cur))
    }).catch(() => {})
  }, [])
  return { launchers, launcher, pickLauncher }
}

// the command presets (GET /api/plugins) — shared by the launch box and live inbox `/` palettes. The route
// returns only command-surface nodes, so the list IS the invocable set — no client filter.
export function useCommandPresets() {
  const [presets, setPresets] = useState([])
  useEffect(() => {
    loadPlugins().then((d) => { if (Array.isArray(d)) setPresets(d) }).catch(() => {})
  }, [])
  return presets
}
