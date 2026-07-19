import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from './i18n/index.jsx'
import { Icon, IconButton } from './icons.jsx'
import {
  CATALOG_POLL_MS, loadProjects, probeProjectHealth, setProjectPassword, clearProjectPassword,
  setAdminPassword, clearAdminPassword, addProject, loadProjectConfig, saveProjectConfig,
  initProject, doctorProject, startProjectBackend, saveGatewayIcon, saveProjectIcon,
} from './projects.js'
import { projectHref, PROJECT_ID } from './project.js'
import CredentialGate from './CredentialGate.jsx'
import { IdentityIcon, IdentityPicker } from './IdentityIcon.jsx'

// The Projects management page ([[projects-hub]]) — the admin face over the hub's landed contract
// ([[gateway-hub]] + [[host-gateway]]): one row per KNOWN project — the host's reconciled view of the
// durable catalog plus the machine's live backend records, so a project appears by running `spex serve`
// in its repo OR by registering its repo root through the add drawer here (POST /projects). Each row
// shows liveness (the host's instance-validated `online` refined by a probed /p/:id/health dot for the
// end-to-end truth), the gating state, a password set/clear drawer, and either Open (online — a plain
// project-scoped link, `/p/<id>/#/graph`) or Start (offline — POST /projects/:id/serve boots the real
// detached `spex serve` and resolves only when its record reconciles online). The settings gear edits
// the raw committed spexcode.json through the host admin surface, even while the backend is offline;
// saves are JSON-validated and revision-guarded. A separate setup drawer runs the REAL spex verbs in
// the repo (POST /projects/:id/init|doctor): init demands the explicit harness choice (the CLI refuses
// without one), while preset stays in spexcode.json; every run renders its exit code + full transcript
// in place, a failure stays visible and the button is the retry. The header
// carries the ADMIN password control: `adminGated:false` means management is implicit-loopback-only, so
// the page offers the bootstrap (the hub keeps the setter signed in by rotating their cookie). It
// renders only as the global `/projects` hub face. Freshness is a plain poll (catalog every few seconds;
// health re-probed per row), so registration, disappearance, and health flips land on their own. An
// 'admin-login'/'locked' catalog answer renders the shared CredentialGate in place, and a project-scope
// visitor never reaches this page at all (the scoped shell never mounts it), so neither the
// catalog nor any management control is ever revealed to a direct-project guest.

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

// The settings gear means settings: edit the ONE portable source file verbatim. Missing files arrive as
// `{}`; the revision returned by the host makes a concurrent disk edit a visible conflict on save.
function ConfigDrawer({ p, onRefresh, t }) {
  const [loaded, setLoaded] = useState(null) // { content, revision } | null
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [reload, setReload] = useState(0)
  const [pickedIcon, setPickedIcon] = useState(p.identity.icon)
  const [iconBusy, setIconBusy] = useState(false)
  const [iconError, setIconError] = useState(null)

  useEffect(() => {
    let live = true
    setLoaded(null); setError(null); setSaved(false)
    loadProjectConfig(p.id).then((r) => {
      if (!live) return
      if (!r.ok) { setError(r.error === 'network' ? t('projects.actionFailed') : r.error); return }
      setLoaded({ content: r.content, revision: r.revision }); setContent(r.content); setPickedIcon(p.identity.icon)
    })
    return () => { live = false }
  }, [p.id, p.identity.icon, reload, t])

  let invalid = false
  try {
    const parsed = JSON.parse(content)
    invalid = !parsed || typeof parsed !== 'object' || Array.isArray(parsed)
  } catch { invalid = true }
  const dirty = !!loaded && content !== loaded.content

  const save = async () => {
    if (!loaded || invalid || !dirty || busy) return
    setBusy(true); setError(null); setSaved(false)
    const r = await saveProjectConfig(p.id, content, loaded.revision)
    setBusy(false)
    if (!r.ok) { setError(r.error === 'network' ? t('projects.actionFailed') : r.error); return }
    setLoaded({ content: r.content, revision: r.revision }); setContent(r.content); setSaved(true)
    try { setPickedIcon(JSON.parse(r.content)?.dashboard?.icon || p.identity.icon) } catch { /* already validated */ }
    onRefresh()
  }

  const pickIcon = async (icon) => {
    if (!loaded || iconBusy) return
    const before = pickedIcon
    setPickedIcon(icon); setIconBusy(true); setIconError(null); setSaved(false)
    const r = await saveProjectIcon(p.id, icon, loaded.revision)
    setIconBusy(false)
    if (!r.ok) { setPickedIcon(before); setIconError(r.error === 'network' ? t('projects.actionFailed') : r.error); return }
    setLoaded({ content: r.content, revision: r.revision }); setContent(r.content); setPickedIcon(r.identity.icon); setSaved(true)
    onRefresh()
  }

  return (
    <div className="proj-drawer proj-config">
      <div className="proj-config-head">
        <code>spexcode.json</code>
        {saved && <span className="proj-op-status ok">{t('projects.configSaved')}</span>}
      </div>
      {!loaded ? (
        <div className="proj-setup-row">
          {!error && <span className="proj-dim">{t('projects.configLoading')}</span>}
          {error && <>
            <span className="proj-err">{error}</span>
            <button className="proj-act" type="button" onClick={() => setReload((n) => n + 1)}>{t('projects.configReload')}</button>
          </>}
        </div>
      ) : <>
        <IdentityPicker
          value={pickedIcon}
          onChange={pickIcon}
          label={t('projects.projectIcon')}
          name={`project-icon-${p.id}`}
          disabled={busy || iconBusy}
        />
        {iconError && <span className="proj-err">{iconError}</span>}
        <textarea
          className={invalid ? 'proj-config-editor invalid' : 'proj-config-editor'}
          value={content}
          onChange={(e) => { setContent(e.target.value); setSaved(false); setError(null) }}
          aria-label={t('projects.configEditor')}
          spellCheck={false}
          disabled={busy}
        />
        <div className="proj-setup-row">
          <button className="proj-act primary" type="button" disabled={!dirty || invalid || busy} onClick={save}>
            {busy ? t('projects.configSaving') : t('projects.configSave')}
          </button>
          <button className="proj-act" type="button" disabled={busy} onClick={() => setReload((n) => n + 1)}>{t('projects.configReload')}</button>
          {invalid && <span className="proj-err">{t('projects.configInvalid')}</span>}
          {error && <span className="proj-err">{error}</span>}
        </div>
      </>}
    </div>
  )
}

// the setup drawer — the real management verbs for one registered repo. init requires the explicit
// harness choice (multi-select chips over the native vocabulary; none picked = the button stays dark),
// while preset stays in spexcode.json; doctor is one press. The result block is the spawned verb's honest
// answer: exit code + transcript, kept on screen (success or failure), the same button the retry.
function SetupDrawer({ p, busyOp, run, result, t }) {
  const [harnesses, setHarnesses] = useState([])
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
        <button
          className="proj-act primary"
          type="button"
          disabled={!!busyOp || !harnesses.length}
          title={harnesses.length ? undefined : t('projects.harnessRequired')}
          onClick={() => run('init', () => initProject(p.id, harnesses.join(',')))}
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
  const [panel, setPanel] = useState(null)   // 'config' | 'setup' | 'pw' | null
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
        <IdentityIcon icon={p.identity.icon} size={26} />
        <span className="proj-name">{p.identity.title}</span>
        {p.gated && <Icon name="lock" size={12} className="proj-locked" />}
        {current && <span className="proj-tag">{t('projects.current')}</span>}
        <span className="proj-path" title={p.id}>{p.root || p.id}</span>
        <span className="proj-actions">
          <IconButton
            icon="settings"
            label={t('projects.configTitle')}
            className={panel === 'config' ? 'proj-act icon on' : 'proj-act icon'}
            size={13}
            onClick={() => { setPanel((v) => (v === 'config' ? null : 'config')); setError(null) }}
          />
          <IconButton
            icon="terminal"
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
      {panel === 'config' && <ConfigDrawer p={p} onRefresh={onRefresh} t={t} />}
      {panel === 'setup' && <SetupDrawer p={p} busyOp={busyOp} run={runOp} result={result} t={t} />}
    </li>
  )
}

function GatewayIdentityEditor({ gateway, onRefresh, t }) {
  const [icon, setIcon] = useState(gateway.identity.icon)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => { setIcon(gateway.identity.icon) }, [gateway.identity.icon])
  const pick = async (next) => {
    if (busy || !gateway.revision) return
    const before = icon
    setIcon(next); setBusy(true); setError(null)
    const r = await saveGatewayIcon(next, gateway.revision)
    setBusy(false)
    if (!r.ok) { setIcon(before); setError(r.error === 'network' ? t('projects.actionFailed') : r.error); return }
    setIcon(r.gateway.identity.icon)
    onRefresh()
  }
  return (
    <div className="proj-gateway-identity">
      <IdentityPicker value={icon} onChange={pick} label={t('projects.gatewayIcon')} name="gateway-icon" disabled={busy || !gateway.revision} />
      {error && <span className="proj-err">{error}</span>}
    </div>
  )
}

export default function ProjectsPage() {
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
      setState({ kind: 'ok', adminGated: r.adminGated, gateway: r.gateway, projects: r.projects })
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
    const id = setInterval(refresh, CATALOG_POLL_MS)
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
        <GatewayIdentityEditor gateway={state.gateway} onRefresh={refresh} t={t} />
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

  const gatewayIdentity = state.kind === 'ok' ? state.gateway.identity : { title: 'Projects', icon: 'gateway' }

  return (
    <div className="page-pane page-projects">
      <div className="proj-body">
        <div className="cred-brand proj-brand">
          <IdentityIcon icon={gatewayIdentity.icon} fallback="gateway" size={30} />
          <span>$ spexcode</span>
        </div>
        <h1 className="page-title">{t('projects.title')}</h1>
        {body}
      </div>
    </div>
  )
}
