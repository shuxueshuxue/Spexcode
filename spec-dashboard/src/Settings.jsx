import { useState } from 'react'
import { useI18n, LANGUAGES } from './i18n/index.jsx'
import { useKeyboardScope } from './KeyboardService.jsx'
import { ACT, displayKeysOf, keyCap } from './keymap.js'
import { keysOf, isCustom, setBinding, resetBindings } from './bindings.js'
import { THEMES, getTheme, applyTheme } from './theme.js'
import { PageScroll } from './PageScroll.jsx'
import { PROJECT_ID } from './project.js'
import { useLaunchers } from './launch.js'
import { loadProjectConfig, saveProjectConfig } from './projects.js'
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

const LAUNCHER_TYPES = ['claude', 'claude-headless', 'codex', 'codex-headless', 'opencode', 'opencode-headless', 'pi', 'pi-headless']

function LauncherProfiles({ t, launchers, refreshLaunchers }) {
  const [name, setName] = useState('')
  const [harness, setHarness] = useState('claude')
  const [cmd, setCmd] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const addLauncher = async () => {
    if (!PROJECT_ID || !name.trim() || !cmd.trim() || busy) return
    setBusy(true); setMessage('')
    const loaded = await loadProjectConfig(PROJECT_ID)
    if (!loaded.ok) { setMessage(loaded.error || t('settings.launcherSaveFailed')); setBusy(false); return }
    try {
      const parsed = JSON.parse(loaded.content)
      const sessions = parsed.sessions && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions) ? parsed.sessions : {}
      const profiles = sessions.launchers && typeof sessions.launchers === 'object' && !Array.isArray(sessions.launchers) ? sessions.launchers : {}
      profiles[name.trim()] = { harness, cmd: cmd.trim() }
      const next = { ...parsed, sessions: { ...sessions, launchers: profiles } }
      const saved = await saveProjectConfig(PROJECT_ID, `${JSON.stringify(next, null, 2)}\n`, loaded.revision)
      if (!saved.ok) { setMessage(saved.error || t('settings.launcherSaveFailed')); setBusy(false); return }
      setName(''); setCmd(''); setMessage(t('settings.launcherSaved'))
      await refreshLaunchers().catch(() => {})
    } catch { setMessage(t('settings.launcherInvalidConfig')) }
    setBusy(false)
  }
  return (
    <Section title={t('settings.secLaunchers')}>
      <p className="set-hint set-section-copy">{t('settings.launchersDescription')}</p>
      <div className="set-launchers" data-settings-launchers>
        {launchers.length ? launchers.map((entry) => {
          const harness = harnessForId(entry.harness)
          const Glyph = harness.Glyph
          return (
            <div className="si-launcher-row" key={entry.name}>
              <span className="si-launcher-row-main">
                <span className="si-launcher-harness" data-tip={harness.label} aria-hidden="true"><Glyph /></span>
                <span className="si-launcher-name">{entry.name}</span>
              </span>
              {entry.cmd ? <span className="si-launcher-cmd">{entry.cmd}</span> : null}
            </div>
          )
        }) : <p className="set-hint">{t('settings.noLaunchers')}</p>}
      </div>
      {PROJECT_ID ? (
        <div className="set-launcher-add">
          <div className="set-launcher-fields">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('settings.launcherName')} aria-label={t('settings.launcherName')} />
            <select value={harness} onChange={(event) => setHarness(event.target.value)} aria-label={t('settings.launcherType')}>
              {LAUNCHER_TYPES.map((id) => <option key={id} value={id}>{harnessForId(id).label}{id.endsWith('-headless') ? ' (headless)' : ''}</option>)}
            </select>
            <input className="set-launcher-command" value={cmd} onChange={(event) => setCmd(event.target.value)} placeholder={t('settings.launcherCommand')} aria-label={t('settings.launcherCommand')} />
          </div>
          <button type="button" className="set-action" onClick={addLauncher} disabled={busy || !name.trim() || !cmd.trim()}>{busy ? t('settings.launcherSaving') : t('settings.launcherAdd')}</button>
          {message && <span className="set-hint">{message}</span>}
        </div>
      ) : null}
      <p className="set-hint set-section-foot">{t('settings.launcherConfigPath')}</p>
    </Section>
  )
}

function ProjectConfigEditor({ t }) {
  const [loaded, setLoaded] = useState(null)
  const [content, setContent] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const read = async () => {
    if (!PROJECT_ID) return
    const result = await loadProjectConfig(PROJECT_ID)
    if (!result.ok) { setMessage(result.error || t('settings.configLoadFailed')); return }
    setLoaded({ content: result.content, revision: result.revision }); setContent(result.content); setMessage('')
  }
  const save = async () => {
    if (!loaded || busy) return
    try { const parsed = JSON.parse(content); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid') } catch { setMessage(t('settings.configInvalid')); return }
    setBusy(true)
    const result = await saveProjectConfig(PROJECT_ID, content.endsWith('\n') ? content : `${content}\n`, loaded.revision)
    setBusy(false)
    if (!result.ok) { setMessage(result.error || t('settings.configSaveFailed')); return }
    setLoaded({ content: result.content, revision: result.revision }); setContent(result.content); setMessage(t('settings.configSaved'))
  }
  if (!PROJECT_ID) return null
  return (
    <Section title={t('settings.secConfig')}>
      <div className="set-config-head">
        <p className="set-hint">{t('settings.configDescription')}</p>
        <button type="button" className="set-action" onClick={() => { setOpen((value) => !value); if (!loaded) void read() }}>{open ? t('settings.configClose') : t('settings.configOpen')}</button>
      </div>
      {open && (loaded ? <>
        <textarea className="set-config-editor" value={content} onChange={(event) => { setContent(event.target.value); setMessage('') }} spellCheck={false} disabled={busy} aria-label={t('settings.configEditor')} />
        <div className="set-config-actions"><button type="button" className="set-action" onClick={save} disabled={busy || content === loaded.content}>{busy ? t('settings.configSaving') : t('settings.configSave')}</button><button type="button" className="set-action" onClick={() => void read()} disabled={busy}>{t('settings.configReload')}</button>{message && <span className="set-hint">{message}</span>}</div>
      </> : <p className="set-hint">{message || t('settings.configLoading')}</p>)}
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
        <LauncherProfiles t={t} launchers={launcherState.launchers} refreshLaunchers={launcherState.refreshLaunchers} />
        <ProjectConfigEditor t={t} />
        <Shortcuts t={t} />
      </div>
    </PageScroll>
  )
}
