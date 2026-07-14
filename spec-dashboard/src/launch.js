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
// send only the chosen launcher name; the backend derives harness from that profile. No launcher yet
// (picker not loaded) → omit it and the backend uses its default. Plain fetch, never a retrying wrapper —
// a retried POST could double-create. Returns { ok, error? }.
export async function createSession(prompt, launcher) {
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(launcher ? { prompt, launcher } : { prompt }),
    })
    const body = await res.json().catch(() => null)
    return { ok: res.ok, error: body?.error }
  } catch {
    return { ok: false }
  }
}

// the configured launcher profiles ([[launcher-select]]) + the current pick. The pick is remembered
// per-browser under the ONE key every surface shares, so phone and desktop agree on it. Initial selection
// honors the config default so the dashboard agrees with the CLI (`spex new` with no --launcher uses
// `defaultLauncher`): remembered pick (if still valid) → configured `default` → first.
export function useLaunchers() {
  const [launchers, setLaunchers] = useState([])
  const [launcher, setLauncher] = useState(() => { try { return localStorage.getItem('si.launcher') || '' } catch { return '' } })
  const pickLauncher = (name) => { setLauncher(name); try { localStorage.setItem('si.launcher', name) } catch {} }
  useEffect(() => {
    loadSettings().then((d) => {
      const list = d?.launchers
      if (!Array.isArray(list) || !list.length) return
      setLaunchers(list)
      setLauncher((cur) => {
        if (list.some((l) => l.name === cur)) return cur   // a still-valid remembered pick wins
        if (d.default && list.some((l) => l.name === d.default)) return d.default   // else the configured default
        return list[0].name   // else the first
      })
    }).catch(() => {})
  }, [])
  return { launchers, launcher, pickLauncher }
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
