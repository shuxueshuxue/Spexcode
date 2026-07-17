import { useEffect, useState } from 'react'
import { loadPlugins, loadSettings } from './data.js'
import { MENTION_RE, specPath } from './mentions.jsx'

// The dashboard's ONE session-launch path, shared by every face that can start a worker — the desktop
// console's New Session tab (SessionInterface.jsx) and the phone's composer (MobileApp.jsx). The grammar,
// the launcher resolution, and the POST live HERE once; a surface only renders its own chrome around them.

// assemble the `/<preset> [[<node>]]… <free text>` launch grammar into one prompt: the preset body with its
// {{targets}} placeholder filled from the mentions (the server later derives the node from the first
// `[[<id>]]`), free text appended. A `/` naming no known preset, or a plain/mention-only prompt, passes through.
export const composeLaunch = (raw, presets, specs) => {
  const m = raw.match(/^\/(\S+)\s*([\s\S]*)$/)
  if (!m) return raw
  const preset = presets.find((p) => p.name === m[1])
  if (!preset) return raw
  const ids = []
  const free = m[2].replace(MENTION_RE, (_, id) => { ids.push(id); return '' }).trim()
  const targets = ids.length
    ? ids.map((id) => {
        const s = specs.find((x) => x.id === id)
        return s ? `- [[${s.id}]] — ${specPath(s.path)}` : `- [[${id}]]`
      }).join('\n')
    : '(No target was mentioned. If the prompt names the scope, use it; otherwise ask the human to define the scope before proceeding — unless this task needs no scope, in which case proceed.)'
  const body = preset.body.includes('{{targets}}')
    ? preset.body.replace('{{targets}}', targets)
    : `${preset.body}\n\n${targets}`
  return free ? `${body}\n\n${free}` : body
}

// launch a session: the one POST /api/sessions. A launcher SUBSUMES the harness ([[launcher-select]]):
// send only the chosen launcher name; the backend derives harness from that profile. The session MODE
// (interactive | headless) rides the same body — the dashboard sends its visible toggle choice explicitly,
// so what the human sees armed is what the backend pins. No launcher/mode yet (picker not loaded) → omit
// them and the backend uses its defaults. Plain fetch, never a retrying wrapper — a retried POST could
// double-create. Returns { ok, error? }.
export async function createSession(prompt, launcher, mode) {
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...(launcher ? { launcher } : {}), ...(mode ? { mode } : {}) }),
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

// a launcher's available session modes — BACKEND-computed availability riding /api/settings
// ([[launcher-select]]'s headless axis); the frontend only consumes it, never re-derives adapter
// knowledge. A payload with no `modes` (an older backend) reads interactive-only.
export const launcherModes = (l) => (Array.isArray(l?.modes) ? l.modes : ['interactive'])

const SESSION_MODES = ['interactive', 'headless']
const rememberedMode = () => {
  try { const m = localStorage.getItem('si.mode'); return SESSION_MODES.includes(m) ? m : '' } catch { return '' }
}
// no remembered pick → the configured `defaultMode` (the popout defaults where a bare `spex session new`
// lands), else interactive — headless is opt-in, never a silent flip.
const initialMode = (configuredDefault, remembered = rememberedMode()) =>
  remembered || (SESSION_MODES.includes(configuredDefault) ? configuredDefault : 'interactive')

// the configured launcher profiles ([[launcher-select]]) + the current pick. The pick is remembered
// per-browser under the ONE key every surface shares, so phone and desktop agree on it. Initial selection
// honors the config default so the dashboard agrees with the CLI (`spex new` with no --launcher uses
// `defaultLauncher`): remembered pick (if still valid) → configured `default` → first.
// The session MODE (interactive | headless) is the second launch axis, remembered beside the launcher
// under 'si.mode' (initial: remembered → configured `defaultMode` → interactive). The two picks are
// validated as a COMBO: headless armed on a launcher whose `modes` excludes it (a remembered pick the
// config no longer honors, or a live toggle on a headless-less launcher) falls back to interactive with
// a visible notice (`modeNotice`, the launcher's name) — never a silent launcher swap, never a silently
// armed create the backend would 400.
export function useLaunchers() {
  const cached = launcherListFrom(launcherSettings)
  const [launchers, setLaunchers] = useState(cached)
  const [launcher, setLauncher] = useState(() => initialLauncher(cached, launcherSettings?.default))
  const [mode, setMode] = useState(() => initialMode(launcherSettings?.defaultMode))
  const [modeNotice, setModeNotice] = useState(null)
  const pickLauncher = (name) => { setLauncher(name); setModeNotice(null); try { localStorage.setItem('si.launcher', name) } catch {} }
  const pickMode = (m) => { setMode(m); setModeNotice(null); try { localStorage.setItem('si.mode', m) } catch {} }
  useEffect(() => {
    loadLauncherSettings().then((d) => {
      const list = launcherListFrom(d)
      if (!list.length) return
      setLaunchers(list)
      setLauncher((cur) => initialLauncher(list, d.default, cur))
      // adopt the configured defaultMode only when the browser has no explicit remembered pick — a pick
      // made before the settings landed is already persisted and wins.
      setMode((cur) => (rememberedMode() ? cur : initialMode(d.defaultMode)))
    }).catch(() => {})
  }, [])
  // the combo guard: headless armed on a launcher that can't do headless bounces back to interactive,
  // loudly (modeNotice carries the launcher name for the surface's inline alert).
  useEffect(() => {
    if (mode !== 'headless' || !launchers.length) return
    const l = launchers.find((x) => x.name === launcher)
    if (!l || launcherModes(l).includes('headless')) return
    setMode('interactive')
    try { localStorage.setItem('si.mode', 'interactive') } catch {}
    setModeNotice(l.name)
  }, [launchers, launcher, mode])
  return { launchers, launcher, pickLauncher, mode, pickMode, modeNotice }
}

// the command presets (GET /api/plugins) — the launch box's `/` palette. The route returns only
// command-surface nodes, so the list IS the launchable set — no client filter.
export function useCommandPresets() {
  const [presets, setPresets] = useState([])
  useEffect(() => {
    loadPlugins().then((d) => { if (Array.isArray(d)) setPresets(d) }).catch(() => {})
  }, [])
  return presets
}
