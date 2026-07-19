import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from './i18n/index.jsx'
import { Icon, IconButton } from './icons.jsx'
import {
  loadProjects, probeProjectHealth, setProjectPassword, clearProjectPassword,
  setAdminPassword, clearAdminPassword, addProject, initProject, doctorProject, startProjectBackend,
} from './projects.js'
import { projectHref, PROJECT_ID } from './project.js'
import CredentialGate from './CredentialGate.jsx'

// The Projects management page ([[projects-hub]]) — the admin face over the hub's landed contract
// ([[gateway-hub]] + [[host-gateway]]): one row per KNOWN project — the host's reconciled view of the
// durable catalog plus the machine's live backend records, so a project appears by running `spex serve`
// in its repo OR by registering its repo root through the add drawer here (POST /projects). Each row
// shows liveness (the host's instance-validated `online` refined by a probed /p/:id/health dot for the
// end-to-end truth), the gating state, a password set/clear drawer, and either Open (online — a plain
// project-scoped link, `/p/<id>/#/graph`) or Start (offline — POST /projects/:id/serve boots the real
// detached `spex serve` and resolves only when its record reconciles online). The setup drawer runs the
// REAL spex verbs in the repo (POST /projects/:id/init|doctor): init demands the explicit harness
// choice (the CLI refuses without one) with the optional preset tier alongside; every run renders its
// exit code + full transcript in place, a failure stays visible and the button is the retry. The header
// carries the ADMIN password control: `adminGated:false` means management is implicit-loopback-only, so
// the page offers the bootstrap (the hub keeps the setter signed in by rotating their cookie). It
// renders in two places from one component: as the hub face at `/` (standalone) and as the `#/projects`
// routed page inside a scoped dashboard. Freshness is a plain poll (catalog every few seconds; health
// re-probed per row), so registration, disappearance, and health flips land on their own. An
// 'admin-login'/'locked' catalog answer renders the shared CredentialGate in place, and a project-scope
// visitor never reaches this page at all (the rail hides it when the catalog is denied), so neither the
// catalog nor any management control is ever revealed to a direct-project guest.

const POLL_MS = 5000
// the CLI's native harness vocabulary, mirrored for the choice chips; the server validates the real
// legality (an unknown id fails loudly in the returned transcript), so this list is presentation only.
const HARNESS_IDS = ['claude', 'codex', 'opencode', 'pi']

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

// the register-a-repo drawer: one path input → POST /projects. The host normalizes the path to the
// repo's main checkout and answers 400 with the human reason for a non-repo — shown verbatim.
function AddProjectForm({ onAdded, t }) {
  const [root, setRoot] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    if (!root.trim() || busy) return
    setBusy(true); setError(null)
    const r = await addProject(root.trim())
    setBusy(false)
    if (r.ok) { setRoot(''); onAdded() }
    else setError(r.error === 'network' ? t('projects.actionFailed') : r.error)
  }
  return (
    <form className="proj-drawer proj-add" onSubmit={submit}>
      <input
        className="proj-add-path"
        value={root}
        onChange={(e) => setRoot(e.target.value)}
        placeholder={t('projects.addPlaceholder')}
        aria-label={t('projects.addPlaceholder')}
        spellCheck={false}
      />
      <button className="proj-act primary" type="submit" disabled={!root.trim() || busy}>
        {busy ? t('projects.addBusy') : t('projects.addSubmit')}
      </button>
      {error && <div className="proj-err proj-full">{error}</div>}
    </form>
  )
}

// the setup drawer — the real management verbs for one registered repo. init requires the explicit
// harness choice (multi-select chips over the native vocabulary; none picked = the button stays dark),
// the preset stays optional; doctor is one press. The result block is the spawned verb's honest
// answer: exit code + transcript, kept on screen (success or failure), the same button the retry.
function SetupDrawer({ p, busyOp, run, result, t }) {
  const [harnesses, setHarnesses] = useState([])
  const [preset, setPreset] = useState('')
  const toggle = (id) => setHarnesses((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]))
  return (
    <div className="proj-drawer proj-setup">
      <div className="proj-setup-row">
        <span className="proj-dim">{t('projects.harnessLabel')}</span>
        {HARNESS_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={harnesses.includes(id) ? 'proj-act on' : 'proj-act'}
            aria-pressed={harnesses.includes(id)}
            disabled={!!busyOp}
            onClick={() => toggle(id)}
          >{id}</button>
        ))}
      </div>
      <div className="proj-setup-row">
        <input
          className="proj-add-path proj-preset"
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          placeholder={t('projects.presetPlaceholder')}
          aria-label={t('projects.presetPlaceholder')}
          spellCheck={false}
          disabled={!!busyOp}
        />
        <button
          className="proj-act primary"
          type="button"
          disabled={!!busyOp || !harnesses.length}
          title={harnesses.length ? undefined : t('projects.harnessRequired')}
          onClick={() => run('init', () => initProject(p.id, harnesses.join(','), preset.trim() || undefined))}
        >{busyOp === 'init' ? t('projects.running') : t('projects.init')}</button>
        <button
          className="proj-act"
          type="button"
          disabled={!!busyOp}
          onClick={() => run('doctor', () => doctorProject(p.id))}
        >{busyOp === 'doctor' ? t('projects.running') : t('projects.doctor')}</button>
      </div>
      {result && (
        <div className="proj-op-result proj-full">
          <div className={result.ok ? 'proj-op-status ok' : 'proj-op-status fail'}>
            {result.ok
              ? t('projects.opOk', { op: t(`projects.${result.op}`) })
              : t('projects.opFail', { op: t(`projects.${result.op}`), code: result.code ?? '?' })}
          </div>
          {result.output ? <pre className="proj-log">{result.output}</pre> : null}
        </div>
      )}
    </div>
  )
}

function ProjectRow({ p, health, onRefresh, t }) {
  const [panel, setPanel] = useState(null)   // 'pw' | 'setup' | null
  const [busy, setBusy] = useState(false)    // password writes
  const [busyOp, setBusyOp] = useState(null) // 'init' | 'doctor' | 'serve' | null
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null) // { op, ok, code, output } from init/doctor
  const current = p.id === PROJECT_ID
  const offline = p.online === false
  // the dot: an offline row is calmly 'stopped' (the host already validated there is no live backend —
  // probing it would only paint a scary red); otherwise the probe's answer is the end-to-end truth.
  const dot = offline ? 'stopped' : health || 'probing'

  const run = async (fn) => {
    setBusy(true); setError(null)
    const r = await fn()
    setBusy(false)
    if (!r.ok) setError(r.error || t('projects.actionFailed'))
    else setPanel(null)
    onRefresh()
  }
  // one op at a time per row; the transcript replaces the previous one so the drawer never accretes.
  const runOp = async (op, fn) => {
    setBusyOp(op); setError(null); setResult(null)
    const r = await fn()
    setBusyOp(null)
    if (op !== 'serve') setResult({ op, ok: r.ok, code: r.code, output: r.output || (r.ok ? '' : r.error || '') })
    else if (!r.ok) setError(r.error || t('projects.actionFailed'))
    onRefresh()
  }

  return (
    <li className={current ? 'proj-row current' : 'proj-row'}>
      <div className="proj-row-main">
        <span className={`proj-health h-${dot}`} data-tip={t(`projects.health.${dot}`)} />
        <span className="proj-name">{p.name}</span>
        {p.gated && <Icon name="lock" size={12} className="proj-locked" />}
        {current && <span className="proj-tag">{t('projects.current')}</span>}
        <span className="proj-path" title={p.id}>{p.root || p.id}</span>
        <span className="proj-actions">
          <IconButton
            icon="settings"
            label={t('projects.setupTitle')}
            className={panel === 'setup' ? 'proj-act icon on' : 'proj-act icon'}
            size={13}
            onClick={() => { setPanel((v) => (v === 'setup' ? null : 'setup')); setError(null) }}
          />
          <IconButton
            icon="lock"
            label={t('projects.passwordTitle')}
            className={panel === 'pw' ? 'proj-act icon on' : 'proj-act icon'}
            size={13}
            onClick={() => { setPanel((v) => (v === 'pw' ? null : 'pw')); setError(null) }}
          />
          {offline ? (
            <button
              className="proj-act primary"
              type="button"
              disabled={!!busyOp}
              onClick={() => runOp('serve', () => startProjectBackend(p.id))}
            >{busyOp === 'serve' ? t('projects.startBusy') : t('projects.start')}</button>
          ) : (
            <a className="proj-act primary" href={projectHref(p.id)}>{t('projects.open')}</a>
          )}
        </span>
      </div>
      {error && <div className="proj-err">{error}</div>}
      {panel === 'pw' && (
        <PasswordForm
          t={t}
          busy={busy}
          placeholder={t('projects.passwordPlaceholder')}
          onSet={(pw) => run(() => setProjectPassword(p.id, pw))}
          onClear={() => run(() => clearProjectPassword(p.id))}
        />
      )}
      {panel === 'setup' && <SetupDrawer p={p} busyOp={busyOp} run={runOp} result={result} t={t} />}
    </li>
  )
}

export default function ProjectsPage({ standalone = false }) {
  const t = useT()
  const [state, setState] = useState({ kind: 'loading' }) // loading | ok | denied | absent
  const [health, setHealth] = useState({})                // id → 'running' | 'unreachable' (probed)
  const [drawer, setDrawer] = useState(null)              // 'admin' | 'add' | null
  const [adminBusy, setAdminBusy] = useState(false)
  const [adminErr, setAdminErr] = useState(null)
  const seq = useRef(0)

  const refresh = useCallback(async () => {
    const mine = ++seq.current
    const r = await loadProjects()
    if (mine !== seq.current) return // freshest-issued wins, same guard as the board
    if (r.state === 'ok') {
      setState({ kind: 'ok', adminGated: r.adminGated, projects: r.projects })
      // health rides its own probes through the authorized /p/:id lane — concurrent, freshest wins per
      // id; a host-validated offline row skips the probe (its dot is 'stopped', not a failed ping).
      r.projects.filter((p) => p.online !== false).forEach((p) => {
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
    else setDrawer(null)
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
          <button className={drawer === 'add' ? 'proj-act on' : 'proj-act'} onClick={() => setDrawer((v) => (v === 'add' ? null : 'add'))}>
            <Icon name="plus" size={12} /> {t('projects.add')}
          </button>
          <button className={drawer === 'admin' ? 'proj-act on' : 'proj-act'} onClick={() => { setDrawer((v) => (v === 'admin' ? null : 'admin')); setAdminErr(null) }}>
            <Icon name="lock" size={12} /> {t('projects.adminPassword')}
          </button>
        </div>
        {!state.adminGated && (
          <div className="proj-hint">{t('projects.adminUngated')}</div>
        )}
        {drawer === 'add' && (
          <div className="proj-admin-pw">
            <AddProjectForm t={t} onAdded={() => { setDrawer(null); refresh() }} />
          </div>
        )}
        {drawer === 'admin' && (
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
