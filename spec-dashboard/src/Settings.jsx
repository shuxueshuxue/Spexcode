import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n, LANGUAGES } from './i18n/index.jsx'
import { useKeyboardScope } from './KeyboardService.jsx'
import { ACT, displayKeysOf, keyCap } from './keymap.js'
import { keysOf, isCustom, setBinding, resetBindings } from './bindings.js'
import { THEMES, getTheme, applyTheme } from './theme.js'
import { PageScroll } from './PageScroll.jsx'
import { PROJECT_ID } from './project.js'
import { useLaunchers, isDashboardVisibleHarness } from './launch.js'
import { addProjectHarnessTarget, loadProjectConfig } from './projects.js'
import { harnessForId } from './harness.jsx'
import {
  getTerminalFontSize,
  setTerminalFontSize,
  TERMINAL_FONT_MIN,
  TERMINAL_FONT_MAX,
  TERMINAL_FONT_STEP,
} from './terminalFont.js'
import {
  SESSION_SURFACE_CONVERSATION,
  SESSION_SURFACE_TERMINAL,
  getDefaultSessionSurface,
  setDefaultSessionSurface,
} from './sessionSurface.js'

// The page's one control grammar: a SECTION is a heading over rows, a ROW is a label beside its control,
// and a choice among a few values is a segmented control — one selected segment, the rest quiet. The
// segments keep the `set-lang` class every list of choices has always worn.
function Section({ title, children }) {
  return (
    <section className="set-sec">
      <h2 className="set-h">{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, children }) {
  return (
    <div className="set-row">
      <span className="set-label">{label}</span>
      <div className="set-control">{children}</div>
    </div>
  )
}

function Segmented({ label, value, options, onPick }) {
  return (
    <div className="set-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" className={option.value === value ? 'set-lang on' : 'set-lang'}
          aria-pressed={option.value === value} onClick={() => onPick(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

// Shortcuts editor — one row per action; a click on a rebindable cell captures the next keypress.
function Shortcuts({ t }) {
  const [, setTick] = useState(0)          // re-render after a binding changes
  const [cap, setCap] = useState(null)       // action id being captured, or null
  const refresh = () => setTick((n) => n + 1)

  // keyboard capture: grab the next real keypress as the binding (Esc cancels, bare modifiers ignored).
  useKeyboardScope((event) => {
    if (!cap) return false
    event.preventDefault(); event.stopPropagation()
    if (event.key === 'Escape') { setCap(null); return true }
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return true
    setBinding(cap, { keys: [event.key] }); setCap(null); refresh(); return true
  }, 20)

  return (
    <Section title={t('settings.secShortcuts')}>
      <div className="set-keys">
        {ACT.map((a) => (
          <div className="set-key-row" key={a.id}>
            <span className="set-key-desc">{t(a.desc)}</span>
            <button
              className={`bind-cell${cap === a.id ? ' capturing' : ''}${a.rebind ? '' : ' fixed'}${isCustom(a.id) ? ' custom' : ''}`}
              disabled={!a.rebind}
              onClick={() => a.rebind && setCap(a.id)}
            >
              {cap === a.id ? <span className="bind-hint">{t('settings.bindPrompt')}</span>
                : displayKeysOf(a, keysOf(a.id)).map((k, i) => <kbd key={i}>{keyCap(k)}</kbd>)}
            </button>
          </div>
        ))}
      </div>
      <div className="set-foot">
        <span className="set-hint">{t('settings.shortcutsHint')}</span>
        <button className="set-reset" onClick={() => { resetBindings(); setCap(null); refresh() }}>{t('settings.reset')}</button>
      </div>
    </Section>
  )
}

// The theme picker shows each preset as itself: its ground under its paper, its ink, its accent — read from
// the registry's swatch, which the styles gate holds to the sheet's theme rows.
function ThemeSwatch({ theme, on, onPick, label }) {
  const { ground, paper, ink, accent } = theme.swatch
  return (
    <button type="button" className={on ? 'set-swatch on' : 'set-swatch'} aria-pressed={on} onClick={onPick}>
      <span className="set-swatch-chip" aria-hidden="true" style={{ background: ground }}>
        <span className="set-swatch-paper" style={{ background: paper, color: ink }}>
          <span className="set-swatch-line" style={{ background: ink }} />
          <span className="set-swatch-line short" style={{ background: accent }} />
        </span>
      </span>
      <span className="set-swatch-name">{label}</span>
    </button>
  )
}

function LauncherProfiles({ t, launchers }) {
  return (
    <Section title={t('settings.secLaunchers')}>
      <p className="set-hint set-section-copy">{t('settings.launchersDescription')}</p>
      <div className="set-launchers" data-settings-launchers>
        {launchers.length ? launchers.map((entry) => {
          const harness = harnessForId(entry.harness)
          const Glyph = harness.Glyph
          return (
            <div className="set-launcher" key={entry.name}>
              <span className="set-launcher-mark" aria-hidden="true"><Glyph /></span>
              <span className="set-launcher-main">
                <strong>{entry.name}</strong>
                <span>{harness.label}</span>
              </span>
              {entry.cmd ? <code>{entry.cmd}</code> : null}
            </div>
          )
        }) : <p className="set-hint">{t('settings.noLaunchers')}</p>}
      </div>
      <p className="set-hint set-section-foot">{t('settings.launcherConfigPath')}</p>
    </Section>
  )
}

function HarnessDelivery({ t, harnessTargets, refreshLaunchers }) {
  const [targets, setTargets] = useState([])
  const [revision, setRevision] = useState('')
  const [phase, setPhase] = useState(PROJECT_ID ? 'loading' : 'unavailable')
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const native = useMemo(() => harnessTargets.filter((id) => isDashboardVisibleHarness(id)), [harnessTargets])
  const available = useMemo(() => native.filter((id) => !targets.includes(id)), [native, targets])

  const read = useCallback(async () => {
    if (!PROJECT_ID) return
    setPhase('loading'); setError('')
    const result = await loadProjectConfig(PROJECT_ID)
    if (!result.ok) { setPhase('error'); setError(result.error || t('settings.harnessLoadFailed')); return }
    try {
      const parsed = JSON.parse(result.content)
      const values = Array.isArray(parsed?.harnesses) ? parsed.harnesses.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean) : []
      setTargets(values.filter((value) => isDashboardVisibleHarness(value)))
      setRevision(result.revision); setPhase('ready')
    } catch { setPhase('error'); setError(t('settings.harnessInvalidConfig')) }
  }, [t])
  useEffect(() => { void read() }, [read])
  useEffect(() => { setSelected((current) => available.includes(current) ? current : (available[0] || '')) }, [available])

  const add = async () => {
    if (!PROJECT_ID || !selected || busy) return
    setBusy(true); setError('')
    const result = await addProjectHarnessTarget(PROJECT_ID, selected, revision)
    if (!result.ok) {
      setError(result.error || t('settings.harnessSaveFailed')); setBusy(false); return
    }
    setRevision(result.revision)
    setTargets(result.harnesses.filter((value) => typeof value === 'string').map((value) => value.trim()).filter((value) => isDashboardVisibleHarness(value)))
    setPhase('ready'); setBusy(false); setSelected('')
    await refreshLaunchers().catch(() => {})
  }

  return (
    <Section title={t('settings.secHarnesses')}>
      <p className="set-hint set-section-copy">{t('settings.harnessesDescription')}</p>
      {!PROJECT_ID ? <p className="set-hint">{t('settings.harnessesNoProject')}</p> : null}
      {phase === 'loading' ? <p className="set-hint">{t('settings.harnessesLoading')}</p> : null}
      {phase === 'error' ? <p className="set-error">{error}</p> : null}
      {phase === 'ready' ? (
        <>
          <div className="set-targets" data-settings-harnesses>
            {targets.length ? targets.map((id) => <span className="set-target" key={id}>{harnessForId(id).label}</span>) : <span className="set-hint">{t('settings.harnessesNone')}</span>}
          </div>
          {available.length ? (
            <div className="set-add-target">
              <select value={selected} onChange={(event) => setSelected(event.target.value)} aria-label={t('settings.harnessesSelect')}>
                {available.map((id) => <option key={id} value={id}>{harnessForId(id).label}</option>)}
              </select>
              <button type="button" className="set-action" onClick={add} disabled={busy || !selected}>{busy ? t('settings.harnessesSaving') : t('settings.harnessesAdd')}</button>
            </div>
          ) : <p className="set-hint">{t('settings.harnessesNoAvailable')}</p>}
        </>
      ) : null}
    </Section>
  )
}

export default function Settings() {
  const { t, lang, setLang } = useI18n()
  const [theme, setThemeState] = useState(getTheme)   // the live-picked theme, echoed in the picker
  const [terminalFontSize, setTerminalFontSizeState] = useState(getTerminalFontSize)
  const [defaultSessionSurface, setDefaultSessionSurfaceState] = useState(getDefaultSessionSurface)
  const launcherState = useLaunchers()
  const pickTheme = (code) => { applyTheme(code); setThemeState(code) }
  const pickTerminalFontSize = (value) => setTerminalFontSizeState(setTerminalFontSize(value))
  const pickDefaultSessionSurface = (surface) => setDefaultSessionSurfaceState(setDefaultSessionSurface(surface))
  return (
    <PageScroll className="page-settings-scroll">
      <div className="settings-body">
        <h1 className="page-title">{t('settings.title')}</h1>
        <Section title={t('settings.secLanguage')}>
          <Row label={t('settings.uiLanguage')}>
            <Segmented label={t('settings.secLanguage')} value={lang} onPick={setLang}
              options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} />
          </Row>
        </Section>
        <Section title={t('settings.secTheme')}>
          <div className="set-swatches" role="group" aria-label={t('settings.secTheme')}>
            {THEMES.map((th) => (
              <ThemeSwatch key={th.code} theme={th} label={t(th.label)} on={th.code === theme} onPick={() => pickTheme(th.code)} />
            ))}
          </div>
        </Section>
        <Section title={t('settings.secTerminal')}>
          <Row label={t('settings.defaultSessionSurface')}>
            <Segmented label={t('settings.defaultSessionSurface')} value={defaultSessionSurface} onPick={pickDefaultSessionSurface}
              options={[
                { value: SESSION_SURFACE_TERMINAL, label: t('session.tabTerminal') },
                { value: SESSION_SURFACE_CONVERSATION, label: t('session.tabConversation') },
              ]} />
          </Row>
          <Row label={t('settings.terminalFontSize')}>
            <label className="set-terminal-font">
              <input
                type="range"
                min={TERMINAL_FONT_MIN}
                max={TERMINAL_FONT_MAX}
                step={TERMINAL_FONT_STEP}
                value={terminalFontSize}
                onChange={(event) => pickTerminalFontSize(event.target.value)}
                aria-label={t('settings.terminalFontSize')}
              />
              <output>{terminalFontSize}px</output>
            </label>
          </Row>
        </Section>
        <LauncherProfiles t={t} launchers={launcherState.launchers} />
        <HarnessDelivery t={t} harnessTargets={launcherState.harnessTargets} refreshLaunchers={launcherState.refreshLaunchers} />
        <Shortcuts t={t} />
      </div>
    </PageScroll>
  )
}
