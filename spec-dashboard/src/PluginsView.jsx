import { useEffect, useState } from 'react'
import { apiUrl } from './project.js'
import { useT } from './i18n/index.jsx'
import { PageScroll } from './PageScroll.jsx'

// THE AUTOMATION, READ BY WHAT IT DOES. Every plugin here is already a spec node and already in the graph,
// so this board is not about making them exist on screen — it is about reading them by the surface they plug
// into instead of the folder they sit in. The folders are shelves: `distill` and `merge` each carry two
// surfaces and can appear only once in a tree, and a hook's event, order and refusal have nowhere in one to
// live. Each row carries its node's own one line and opens the node; nothing here restates a body.
//
// @@@normal-is-not-drawable - the first version of this board was a badge farm: order, refusal, file count
// and surface all rendered as chips on every row, so nothing stood out because everything was marked. The
// rule that fixes it is not "fewer chips", it is that a marker for the ORDINARY case must be unrepresentable.
// So `Mark` returns null unless the thing it names is true, `order` is drawn only on an event that carries
// more than one hook (the only place the number decides anything — elsewhere position already says it), and
// a file count is drawn only when files exist. A row with nothing remarkable therefore renders as its name
// and its sentence, which is what a reader should be able to skim past.
//
// The colour budget is one narrow left column and nothing else. A refusing hook puts its mark there, so the
// hooks that can interrupt a session form a broken vertical line a reader finds without reading — and the
// row itself is never tinted, because a tinted row spends colour on the whole line to say one word.

const specHref = (name) => `#/spec/${encodeURIComponent(name)}`

// a mark exists only when it is TRUE; there is no neutral variant to render by accident
const Mark = ({ when, glyph, tone, tip }) => (when
  ? <span className={`pg-mark pg-${tone}`} data-tip={tip} aria-label={tip}>{glyph}</span>
  : null)

function Row({ row, mark = null, meta = null, dim = false }) {
  return (
    <a className={dim ? 'pg-row is-dim' : 'pg-row'} href={specHref(row.name)}>
      <span className="pg-rail">{mark}</span>
      <span className="pg-body">
        <span className="pg-name">{row.name}</span>
        {row.desc && <span className="pg-desc">{row.desc}</span>}
      </span>
      {meta && <span className="pg-meta">{meta}</span>}
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

  if (error) return <PageScroll><div className="pg"><p className="pg-error">{t('plugins.failed', { reason: error })}</p></div></PageScroll>
  if (!view) return <PageScroll><div className="pg" /></PageScroll>

  const { rows, spine, profile } = view
  const byName = new Map(rows.map((row) => [row.name, row]))
  const system = rows.filter((row) => row.surfaces.includes('system'))
  const invoked = rows.filter((row) => row.surfaces.includes('skill') || row.surfaces.includes('command'))
  const unused = ['hook', 'system', 'command', 'skill', 'agent'].filter((s) => !rows.some((r) => r.surfaces.includes(s)))
  // a hook ships exactly one script by construction (the manifest compiler refuses one that does not), so
  // the count is a constant there and drawing it would mark every row to say nothing. Elsewhere a co-located
  // file is a real fact about the node — `core` carries seven, `distill` ships an executable.
  const files = (row) => (row.files.length ? <span className="pg-files">{row.files.length}</span> : null)

  return (
    <PageScroll>
      <div className="pg">
        <header className="pg-head">
          <h1 className="pg-title">{t('plugins.title')}</h1>
          <p className="pg-sub">
            {t('plugins.sub', { nodes: rows.length, surfaces: rows.reduce((n, r) => n + r.surfaces.length, 0) })}
            <span className="pg-profile">
              <code>{profile.name}</code>
              {profile.disables.length === 0
                ? t('plugins.profileAll', { n: profile.retains.length })
                : t('plugins.profileSome', { kept: profile.retains.length, off: profile.disables.join(', ') })}
            </span>
          </p>
        </header>

        <section className="pg-section">
          <h2 className="pg-h">{t('plugins.spine')}</h2>
          <p className="pg-note">{t('plugins.spineNote')}</p>
          <ol className="pg-spine">
            {spine.map((slot) => (
              <li key={slot.event} className={slot.hooks.length ? 'pg-stop' : 'pg-stop is-empty'}>
                <span className="pg-event">
                  {slot.event}
                  {slot.offSpine && <em className="pg-offspine">{t('plugins.offSpine')}</em>}
                </span>
                <span className="pg-hooks">
                  {slot.hooks.length === 0
                    ? <span className="pg-nothing">{t('plugins.nothingRuns')}</span>
                    : slot.hooks.map((hook) => (
                      <Row key={hook.name}
                        row={byName.get(hook.name) || { name: hook.name, desc: '', files: [] }}
                        dim={profile.disables.includes(hook.name)}
                        mark={<Mark when={hook.block} glyph="⊘" tone="refuse" tip={t('plugins.blocksTip')} />}
                        meta={<>
                          {/* the number only decides something where an event carries more than one hook */}
                          {slot.hooks.length > 1 && <span className="pg-ord" data-tip={t('plugins.orderTip')}>{hook.order}</span>}
                          {profile.disables.includes(hook.name) && <span className="pg-dimword">{t('plugins.disabled')}</span>}
                        </>} />
                    ))}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="pg-section">
          <h2 className="pg-h">{t('plugins.alwaysOn')}</h2>
          <p className="pg-note">{t('plugins.alwaysOnNote')}</p>
          <div className="pg-list">{system.map((row) => <Row key={row.name} row={row} meta={files(row)} />)}</div>
        </section>

        <section className="pg-section">
          <h2 className="pg-h">{t('plugins.invoked')}</h2>
          <p className="pg-note">{t('plugins.invokedNote')}</p>
          <div className="pg-list">
            {invoked.map((row) => {
              const both = row.surfaces.includes('skill') && row.surfaces.includes('command')
              return <Row key={row.name} row={row} meta={<>
                {/* two surfaces at once is the one thing a folder tree cannot show, so it is the one that earns colour */}
                <span className={both ? 'pg-surf is-both' : 'pg-surf'}>
                  {both ? t('plugins.bothSurfaces') : row.surfaces.includes('skill') ? 'skill' : 'command'}
                </span>
                {files(row)}
              </>} />
            })}
          </div>
        </section>

        {unused.length > 0 && <p className="pg-unused">{t('plugins.unused', { names: unused.join(', ') })}</p>}
      </div>
    </PageScroll>
  )
}
