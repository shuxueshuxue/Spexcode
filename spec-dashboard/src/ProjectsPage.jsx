import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from './i18n/index.jsx'
import { Icon, IconButton, ClaudeCodeGlyph, CodexGlyph, OpencodeGlyph, PiGlyph } from './icons.jsx'
import { loadProjects, addProject, initProject, startProject, doctorProject, setProjectPassword, clearProjectPassword } from './projects.js'
import { projectHref, PROJECT_ID } from './project.js'
import CredentialGate from './CredentialGate.jsx'

// The Projects management page ([[projects-hub]]) — the catalog face of the multi-project gateway: one
// row per registered project with its live health, plus the graphical management verbs (add-repository
// with an EXPLICIT harness choice, init, doctor, start, per-project password set/clear) and Open as a
// plain project-scoped link (`/p/<id>/#/graph` — the address bar stays the shareable URL; switching
// projects is ordinary same-tab navigation, extra tabs optional, never required). It renders in two
// places from one component: as the hub face at `/` (standalone) and as the `#/projects` routed page
// inside a scoped dashboard. Freshness is a plain poll — the catalog re-reads every few seconds while
// mounted, so registration, disappearance, and health flips land on their own ([[dashboard-shell]]'s
// board keeps its heavier push machinery; the catalog is small and root-scoped, a poll is proportionate).
// An 'admin-login'/'locked' catalog answer renders the shared CredentialGate in place — the same card the
// project unlock uses — and a project-scope visitor simply never reaches this page (the rail hides it
// when the catalog is denied), so the catalog is never revealed to a direct-project guest.

const HARNESSES = [
  { id: 'claude', label: 'Claude Code', Glyph: ClaudeCodeGlyph },
  { id: 'codex', label: 'Codex', Glyph: CodexGlyph },
  { id: 'opencode', label: 'opencode', Glyph: OpencodeGlyph },
  { id: 'pi', label: 'pi', Glyph: PiGlyph },
]

const POLL_MS = 5000

function HarnessPicker({ value, onChange, t }) {
  return (
    <div className="proj-harnesses" role="group" aria-label={t('projects.harnessLabel')}>
      {HARNESSES.map(({ id, label, Glyph }) => {
        const on = value.includes(id)
        return (
          <button
            key={id}
            type="button"
            className={on ? 'proj-harness on' : 'proj-harness'}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((h) => h !== id) : [...value, id])}
          >
            <Glyph />
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

// the add-repository form: a path, an explicit harness choice, one POST. Errors render inline and loud.
function AddForm({ onDone, t }) {
  const [path, setPath] = useState('')
  const [harnesses, setHarnesses] = useState(['claude'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    if (!path.trim() || !harnesses.length || busy) return
    setBusy(true); setError(null)
    const r = await addProject(path.trim(), harnesses)
    setBusy(false)
    if (r.ok) { setPath(''); onDone() }
    else setError(r.error || t('projects.addFailed'))
  }
  return (
    <form className="proj-add" onSubmit={submit}>
      <div className="proj-add-row">
        <input
          className="proj-add-path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={t('projects.pathPlaceholder')}
          aria-label={t('projects.pathLabel')}
          spellCheck={false}
        />
        <button className="proj-act primary" type="submit" disabled={busy || !path.trim() || !harnesses.length}>
          {busy ? t('projects.adding') : t('projects.addConfirm')}
        </button>
      </div>
      <HarnessPicker value={harnesses} onChange={setHarnesses} t={t} />
      {!harnesses.length && <div className="proj-err">{t('projects.harnessRequired')}</div>}
      {error && <div className="proj-err">{error}</div>}
    </form>
  )
}

// one catalog row. `panel` is the row's single expandable drawer: null | 'doctor' | 'password' | 'init' —
// one at a time so the list keeps its density.
function ProjectRow({ p, onRefresh, t }) {
  const [panel, setPanel] = useState(null)
  const [busy, setBusy] = useState(null) // the verb in flight, for per-action busy text
  const [doctorOut, setDoctorOut] = useState(null)
  const [pw, setPw] = useState('')
  const [initHarnesses, setInitHarnesses] = useState(['claude'])
  const [error, setError] = useState(null)
  const current = p.id === PROJECT_ID

  const run = async (verb, fn) => {
    setBusy(verb); setError(null)
    const r = await fn()
    setBusy(null)
    if (!r.ok) setError(r.error || t('projects.actionFailed', { action: verb }))
    onRefresh()
    return r
  }
  const runDoctor = async () => {
    setPanel('doctor'); setDoctorOut(null)
    const r = await run('doctor', () => doctorProject(p.id))
    setDoctorOut(r.output || r.report || (r.ok ? t('projects.doctorEmpty') : ''))
  }
  const healthKnown = ['running', 'stopped', 'unreachable'].includes(p.health)

  return (
    <li className={current ? 'proj-row current' : 'proj-row'}>
      <div className="proj-row-main">
        <span className={`proj-health h-${p.health}`} data-tip={healthKnown ? t(`projects.health.${p.health}`) : p.health} />
        <span className="proj-name">{p.name}</span>
        {p.locked && <Icon name="lock" size={12} className="proj-locked" />}
        {current && <span className="proj-tag">{t('projects.current')}</span>}
        <span className="proj-path" title={p.path}>{p.path}</span>
        <span className="proj-actions">
          {!p.initialized && (
            <button className="proj-act" onClick={() => { setPanel(panel === 'init' ? null : 'init'); setError(null) }}>
              {t('projects.init')}
            </button>
          )}
          {p.health !== 'running' && (
            <button className="proj-act" disabled={busy === 'start'} onClick={() => run('start', () => startProject(p.id))}>
              {busy === 'start' ? t('projects.starting') : t('projects.start')}
            </button>
          )}
          <button className="proj-act" disabled={busy === 'doctor'} onClick={runDoctor}>
            {busy === 'doctor' ? t('projects.doctorRunning') : t('projects.doctor')}
          </button>
          <IconButton
            icon="lock"
            label={t('projects.passwordTitle')}
            className={panel === 'password' ? 'proj-act icon on' : 'proj-act icon'}
            size={13}
            onClick={() => { setPanel(panel === 'password' ? null : 'password'); setError(null) }}
          />
          <a className="proj-act primary" href={projectHref(p.id)}>{t('projects.open')}</a>
        </span>
      </div>
      {error && <div className="proj-err">{error}</div>}
      {panel === 'doctor' && (
        <div className="proj-drawer">
          {doctorOut === null ? <span className="proj-dim">{t('projects.doctorRunning')}</span> : <pre className="proj-doctor-out">{doctorOut}</pre>}
          <button className="proj-act" onClick={() => setPanel(null)}>{t('projects.close')}</button>
        </div>
      )}
      {panel === 'password' && (
        <form
          className="proj-drawer proj-pw"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!pw) return
            const r = await run('password', () => setProjectPassword(p.id, pw))
            if (r.ok) { setPw(''); setPanel(null) }
          }}
        >
          <input
            className="proj-add-path"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder={t('projects.passwordPlaceholder')}
            aria-label={t('projects.passwordTitle')}
          />
          <button className="proj-act primary" type="submit" disabled={!pw || busy === 'password'}>{t('projects.passwordSet')}</button>
          <button
            className="proj-act"
            type="button"
            disabled={busy === 'password'}
            onClick={async () => { const r = await run('password', () => clearProjectPassword(p.id)); if (r.ok) setPanel(null) }}
          >
            {t('projects.passwordClear')}
          </button>
        </form>
      )}
      {panel === 'init' && (
        <div className="proj-drawer proj-init">
          <HarnessPicker value={initHarnesses} onChange={setInitHarnesses} t={t} />
          <button
            className="proj-act primary"
            disabled={busy === 'init' || !initHarnesses.length}
            onClick={async () => { const r = await run('init', () => initProject(p.id, initHarnesses)); if (r.ok) setPanel(null) }}
          >
            {busy === 'init' ? t('projects.initRunning') : t('projects.initConfirm')}
          </button>
        </div>
      )}
    </li>
  )
}

export default function ProjectsPage({ standalone = false }) {
  const t = useT()
  const [state, setState] = useState({ kind: 'loading' }) // loading | ok | denied | absent
  const [adding, setAdding] = useState(false)
  const seq = useRef(0)

  const refresh = useCallback(async () => {
    const mine = ++seq.current
    const r = await loadProjects()
    if (mine !== seq.current) return // freshest-issued wins, same guard as the board
    if (r.state === 'ok') setState({ kind: 'ok', projects: r.projects })
    else if (r.state === 'denied') setState({ kind: 'denied', reason: r.reason })
    else setState((s) => (s.kind === 'ok' ? s : { kind: 'absent' })) // a transient miss keeps the last catalog
  }, [])

  // live appearance/disappearance/health: poll while mounted, plus an immediate re-read when the tab
  // becomes visible again (the poll would catch it anyway; this trims the staleness a wake resumes with).
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_MS)
    const onVis = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [refresh])

  const body = (() => {
    if (state.kind === 'loading') return <div className="loading">{t('hud.loading')}</div>
    if (state.kind === 'denied') return <CredentialGate scope="admin" locked={state.reason === 'locked'} onUnlocked={refresh} />
    if (state.kind === 'absent') {
      return (
        <div className="proj-empty">
          <p>{t('projects.absent')}</p>
        </div>
      )
    }
    return (
      <>
        <div className="proj-head">
          <span className="proj-count">{t('projects.count', { n: state.projects.length })}</span>
          <button className={adding ? 'proj-act on' : 'proj-act'} onClick={() => setAdding((v) => !v)}>
            <Icon name={adding ? 'x' : 'plus'} size={13} /> {adding ? t('projects.addCancel') : t('projects.add')}
          </button>
        </div>
        {adding && <AddForm t={t} onDone={() => { setAdding(false); refresh() }} />}
        {state.projects.length ? (
          <ul className="proj-list">
            {state.projects.map((p) => <ProjectRow key={p.id} p={p} onRefresh={refresh} t={t} />)}
          </ul>
        ) : (
          <div className="proj-empty"><p>{t('projects.empty')}</p></div>
        )}
      </>
    )
  })()

  return (
    <div className={standalone ? 'page-pane page-projects standalone' : 'page-pane page-projects'}>
      <div className="proj-body">
        {standalone && <div className="cred-brand proj-brand">$ spexcode</div>}
        <h1 className="page-title">{t('projects.title')}</h1>
        {body}
      </div>
    </div>
  )
}
