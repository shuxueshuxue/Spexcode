import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from './i18n/index.jsx'
import { Icon, IconButton } from './icons.jsx'
import { loadProjects, probeProjectHealth, setProjectPassword, clearProjectPassword, setAdminPassword, clearAdminPassword } from './projects.js'
import { projectHref, PROJECT_ID } from './project.js'
import CredentialGate from './CredentialGate.jsx'

// The Projects management page ([[projects-hub]]) — the admin face over the hub's landed contract
// ([[gateway-hub]]): one row per REGISTERED project (the registry is the machine's live backend records —
// a project appears by running `spex serve` in its repo, so there is no add/init verb here; the empty
// state says exactly that), each with a probed health dot, its gating state, a password set/clear drawer
// (PUT/DELETE, admin scope), and Open as a plain project-scoped link (`/p/<id>/#/graph` — the address bar
// stays the shareable URL; switching projects is ordinary same-tab navigation, extra tabs optional, never
// required). The header carries the ADMIN password control: `adminGated:false` means management is
// implicit-loopback-only, so the page offers the bootstrap ("set an admin password to sign in remotely" —
// the hub keeps the setter signed in by rotating their cookie in the same response). It renders in two
// places from one component: as the hub face at `/` (standalone) and as the `#/projects` routed page
// inside a scoped dashboard. Freshness is a plain poll (catalog every few seconds; health re-probed per
// row through the authorized /p/:id lane), so registration, disappearance, and health flips land on
// their own. An 'admin-login'/'locked' catalog answer renders the shared CredentialGate in place — the
// same card the project unlock uses — and a project-scope visitor never reaches this page at all (the
// rail hides it when the catalog is denied), so the catalog is never revealed to a direct-project guest.

const POLL_MS = 5000

// a small set/clear password drawer — one shape for the admin credential and every project row.
function PasswordForm({ onSet, onClear, placeholder, busy, t }) {
  const [pw, setPw] = useState('')
  return (
    <form
      className="proj-drawer proj-pw"
      onSubmit={(e) => { e.preventDefault(); if (pw) { onSet(pw); setPw('') } }}
    >
      <input
        className="proj-add-path"
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <button className="proj-act primary" type="submit" disabled={!pw || busy}>{t('projects.passwordSet')}</button>
      <button className="proj-act" type="button" disabled={busy} onClick={onClear}>{t('projects.passwordClear')}</button>
    </form>
  )
}

function ProjectRow({ p, health, onRefresh, t }) {
  const [panel, setPanel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const current = p.id === PROJECT_ID
  const run = async (fn) => {
    setBusy(true); setError(null)
    const r = await fn()
    setBusy(false)
    if (!r.ok) setError(r.error || t('projects.actionFailed'))
    else setPanel(false)
    onRefresh()
  }
  return (
    <li className={current ? 'proj-row current' : 'proj-row'}>
      <div className="proj-row-main">
        <span className={`proj-health h-${health || 'probing'}`} data-tip={t(`projects.health.${health || 'probing'}`)} />
        <span className="proj-name">{p.name}</span>
        {p.gated && <Icon name="lock" size={12} className="proj-locked" />}
        {current && <span className="proj-tag">{t('projects.current')}</span>}
        <span className="proj-path" title={p.id}>{p.id}</span>
        <span className="proj-actions">
          <IconButton
            icon="lock"
            label={t('projects.passwordTitle')}
            className={panel ? 'proj-act icon on' : 'proj-act icon'}
            size={13}
            onClick={() => { setPanel((v) => !v); setError(null) }}
          />
          <a className="proj-act primary" href={projectHref(p.id)}>{t('projects.open')}</a>
        </span>
      </div>
      {error && <div className="proj-err">{error}</div>}
      {panel && (
        <PasswordForm
          t={t}
          busy={busy}
          placeholder={t('projects.passwordPlaceholder')}
          onSet={(pw) => run(() => setProjectPassword(p.id, pw))}
          onClear={() => run(() => clearProjectPassword(p.id))}
        />
      )}
    </li>
  )
}

export default function ProjectsPage({ standalone = false }) {
  const t = useT()
  const [state, setState] = useState({ kind: 'loading' }) // loading | ok | denied | absent
  const [health, setHealth] = useState({})                // id → 'running' | 'unreachable' (probed)
  const [adminPanel, setAdminPanel] = useState(false)
  const [adminBusy, setAdminBusy] = useState(false)
  const [adminErr, setAdminErr] = useState(null)
  const seq = useRef(0)

  const refresh = useCallback(async () => {
    const mine = ++seq.current
    const r = await loadProjects()
    if (mine !== seq.current) return // freshest-issued wins, same guard as the board
    if (r.state === 'ok') {
      setState({ kind: 'ok', adminGated: r.adminGated, projects: r.projects })
      // health rides its own probes through the authorized /p/:id lane — concurrent, freshest wins per id
      r.projects.forEach((p) => {
        probeProjectHealth(p.id).then((h) => { if (mine === seq.current) setHealth((m) => ({ ...m, [p.id]: h })) })
      })
    } else if (r.state === 'denied') setState({ kind: 'denied', reason: r.reason })
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

  const runAdmin = async (fn) => {
    setAdminBusy(true); setAdminErr(null)
    const r = await fn()
    setAdminBusy(false)
    if (!r.ok) setAdminErr(r.error || t('projects.actionFailed'))
    else setAdminPanel(false)
    refresh()
  }

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
          <button className={adminPanel ? 'proj-act on' : 'proj-act'} onClick={() => { setAdminPanel((v) => !v); setAdminErr(null) }}>
            <Icon name="lock" size={12} /> {t('projects.adminPassword')}
          </button>
        </div>
        {!state.adminGated && (
          <div className="proj-hint">{t('projects.adminUngated')}</div>
        )}
        {adminPanel && (
          <div className="proj-admin-pw">
            <PasswordForm
              t={t}
              busy={adminBusy}
              placeholder={t('projects.adminPasswordPlaceholder')}
              onSet={(pw) => runAdmin(() => setAdminPassword(pw))}
              onClear={() => runAdmin(() => clearAdminPassword())}
            />
            {adminErr && <div className="proj-err">{adminErr}</div>}
          </div>
        )}
        {state.projects.length ? (
          <ul className="proj-list">
            {state.projects.map((p) => <ProjectRow key={p.id} p={p} health={health[p.id]} onRefresh={refresh} t={t} />)}
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
