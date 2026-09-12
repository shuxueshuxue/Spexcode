import { useEffect, useState } from 'react'
import { apiUrl } from './project.js'
import { Icon } from './icons.jsx'
import { useT } from './i18n/index.jsx'

// THE AUTOMATION, DRAWN AS WHAT IT DOES. Every plugin here is already a spec node and already visible in the
// graph, so this page is not about making them exist on screen — it is about reading them by their surface
// instead of by their folder. The folders are shelves: `distill` and `merge` each carry two surfaces and can
// only appear once in a tree, and a hook's event, order and blocking intent have nowhere to live in one.
//
// The spine is the hook surface and only the hook surface, because only the hook surface has a timeline: an
// event, a deterministic order inside it, and whether the script may refuse. The other surfaces are not
// event-driven and are not forced onto it — always-on prose and invocable verbs each get their own strip.

export default function PluginsView() {
  const t = useT()
  const [view, setView] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    fetch(apiUrl('/api/plugins/surfaces'))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => { if (live) setView(data) })
      .catch((err) => { if (live) setError(err.message || String(err)) })
    return () => { live = false }
  }, [])

  if (error) return <div className="pg pg-error">{t('plugins.failed', { reason: error })}</div>
  if (!view) return <div className="pg pg-loading" />

  const { rows, spine } = view
  const bySurface = (s) => rows.filter((r) => r.surfaces.includes(s))
  const invoked = rows.filter((r) => r.surfaces.includes('skill') || r.surfaces.includes('command'))
  const unused = ['hook', 'system', 'command', 'skill', 'agent'].filter((s) => bySurface(s).length === 0)

  return (
    <div className="pg">
      <header className="pg-head">
        <h1 className="pg-title">{t('plugins.title')}</h1>
        <p className="pg-sub">{t('plugins.sub', { nodes: rows.length, surfaces: rows.reduce((n, r) => n + r.surfaces.length, 0) })}</p>
      </header>

      <section className="pg-section">
        <h2 className="pg-h">{t('plugins.spine')}</h2>
        <ol className="pg-spine">
          {spine.map((slot) => (
            <li key={slot.event} className={slot.hooks.length ? 'pg-slot' : 'pg-slot is-empty'}>
              <span className="pg-event">{slot.event}{slot.offSpine && <em>{t('plugins.offSpine')}</em>}</span>
              <span className="pg-hooks">
                {slot.hooks.length === 0
                  ? <span className="pg-nothing">{t('plugins.nothingRuns')}</span>
                  : slot.hooks.map((h) => (
                    <span key={h.name} className={h.block ? 'pg-hook blocks' : 'pg-hook'}>
                      {h.name}
                      <em className="pg-order">{h.order}</em>
                      {h.block && <em className="pg-blocks">{t('plugins.blocks')}</em>}
                    </span>
                  ))}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="pg-section">
        <h2 className="pg-h">{t('plugins.alwaysOn')}</h2>
        <p className="pg-note">{t('plugins.alwaysOnNote')}</p>
        <div className="pg-strip">
          {bySurface('system').map((r) => (
            <span className="pg-chip" key={r.name} data-tip={r.desc || undefined}>{r.name}</span>
          ))}
        </div>
      </section>

      <section className="pg-section">
        <h2 className="pg-h">{t('plugins.invoked')}</h2>
        <p className="pg-note">{t('plugins.invokedNote')}</p>
        <div className="pg-strip">
          {invoked.map((r) => {
            const both = r.surfaces.includes('skill') && r.surfaces.includes('command')
            return (
              <span className={both ? 'pg-chip is-both' : 'pg-chip'} key={r.name} data-tip={r.desc || undefined}>
                {r.name}
                <em>{both ? t('plugins.bothSurfaces') : r.surfaces.includes('skill') ? 'skill' : 'command'}</em>
                {r.files.length > 0 && <Icon name="files" size={11} />}
              </span>
            )
          })}
        </div>
      </section>

      {unused.length > 0 && (
        <p className="pg-unused">{t('plugins.unused', { names: unused.join(', ') })}</p>
      )}
    </div>
  )
}
