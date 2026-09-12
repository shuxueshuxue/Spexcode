import { useEffect, useState } from 'react'
import { apiUrl } from './project.js'
import { Icon } from './icons.jsx'
import { useT } from './i18n/index.jsx'
import { PageScroll } from './PageScroll.jsx'

// THE AUTOMATION, DRAWN AS WHAT IT DOES. Every plugin here is already a spec node and already visible in the
// graph, so this board is not about making them exist on screen — it is about reading them by their surface
// instead of by their folder. The folders are shelves: `distill` and `merge` each carry two surfaces and can
// only appear once in a tree, and a hook's event, order and blocking intent have nowhere in one to live.
//
// EVERY ROW SAYS WHAT IT IS FOR AND OPENS. A name and a number is a fact nobody asked for; the question a
// person brings here is "what does this do, and why is it allowed to refuse". Both answers are already
// written — the node's `desc` is its one line and its body is the rest — so a row carries the line and links
// to the body rather than restating either. The link is the ordinary `#/spec/<id>` address, because these ARE
// spec nodes and the reader it opens is the one the rest of the dashboard already uses.
//
// The spine is the hook surface and only the hook surface, because only the hook surface has a timeline. The
// others are not event-driven and are not forced onto it.

const specHref = (name) => `#/spec/${encodeURIComponent(name)}`

function Plugin({ row, meta }) {
  return (
    <a className="pg-card" href={specHref(row.name)}>
      <span className="pg-card-head">
        <span className="pg-card-name">{row.name}</span>
        {meta}
        {row.files.length > 0 && (
          <span className="pg-card-files" data-tip={row.files.map((f) => f.split('/').pop()).join(' · ')}>
            <Icon name="files" size={11} />{row.files.length}
          </span>
        )}
      </span>
      {row.desc && <span className="pg-card-desc">{row.desc}</span>}
    </a>
  )
}

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

  if (error) return <PageScroll><div className="pg pg-error">{t('plugins.failed', { reason: error })}</div></PageScroll>
  if (!view) return <PageScroll><div className="pg pg-loading" /></PageScroll>

  const { rows, spine, profile } = view
  const byName = new Map(rows.map((row) => [row.name, row]))
  const on = (surface) => rows.filter((row) => row.surfaces.includes(surface))
  const invoked = rows.filter((row) => row.surfaces.includes('skill') || row.surfaces.includes('command'))
  const unused = ['hook', 'system', 'command', 'skill', 'agent'].filter((surface) => on(surface).length === 0)

  return (
    <PageScroll>
    <div className="pg">
      <header className="pg-head">
        <h1 className="pg-title">{t('plugins.title')}</h1>
        <p className="pg-sub">{t('plugins.sub', { nodes: rows.length, surfaces: rows.reduce((n, r) => n + r.surfaces.length, 0) })}</p>
      </header>

      {/* the one switch that turns these off, shown as the state it is — this board reads it, never writes it */}
      <section className="pg-profile">
        <span className="pg-profile-key">{t('plugins.profile')}</span>
        <code>{profile.name}</code>
        <span className="pg-profile-note">
          {profile.disables.length === 0
            ? t('plugins.profileAll', { n: profile.retains.length })
            : t('plugins.profileSome', { kept: profile.retains.length, off: profile.disables.join(', ') })}
        </span>
      </section>

      <section className="pg-section">
        <h2 className="pg-h">{t('plugins.spine')}</h2>
        <p className="pg-note">{t('plugins.spineNote')}</p>
        <ol className="pg-spine">
          {spine.map((slot) => (
            <li key={slot.event} className={slot.hooks.length ? 'pg-stop' : 'pg-stop is-empty'}>
              <span className="pg-event">
                {slot.event}
                {slot.offSpine && <em className="pg-off">{t('plugins.offSpine')}</em>}
              </span>
              <span className="pg-stop-cards">
                {slot.hooks.length === 0
                  ? <span className="pg-nothing">{t('plugins.nothingRuns')}</span>
                  : slot.hooks.map((hook) => {
                    const row = byName.get(hook.name) || { name: hook.name, desc: '', files: [] }
                    const off = profile.disables.includes(hook.name)
                    return (
                      <span key={hook.name} className={off ? 'pg-slot-wrap is-off' : 'pg-slot-wrap'}>
                        <Plugin row={row} meta={<>
                          <span className="pg-ord" data-tip={t('plugins.orderTip')}>{hook.order}</span>
                          {hook.block && <span className="pg-blocks" data-tip={t('plugins.blocksTip')}>{t('plugins.blocks')}</span>}
                          {off && <span className="pg-offbadge">{t('plugins.disabled')}</span>}
                        </>} />
                      </span>
                    )
                  })}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="pg-section">
        <h2 className="pg-h">{t('plugins.alwaysOn')}</h2>
        <p className="pg-note">{t('plugins.alwaysOnNote')}</p>
        <div className="pg-grid">{on('system').map((row) => <Plugin key={row.name} row={row} />)}</div>
      </section>

      <section className="pg-section">
        <h2 className="pg-h">{t('plugins.invoked')}</h2>
        <p className="pg-note">{t('plugins.invokedNote')}</p>
        <div className="pg-grid">
          {invoked.map((row) => {
            const both = row.surfaces.includes('skill') && row.surfaces.includes('command')
            return <Plugin key={row.name} row={row}
              meta={<span className={both ? 'pg-surf is-both' : 'pg-surf'}>
                {both ? t('plugins.bothSurfaces') : row.surfaces.includes('skill') ? 'skill' : 'command'}
              </span>} />
          })}
        </div>
      </section>

      {unused.length > 0 && <p className="pg-unused">{t('plugins.unused', { names: unused.join(', ') })}</p>}
    </div>
    </PageScroll>
  )
}
