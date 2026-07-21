import { useEffect, useState } from 'react'
import { useI18n, LANGUAGES } from './i18n/index.jsx'
import { ACT, keyCap } from './keymap.js'
import { keysOf, isCustom, setBinding, resetBindings } from './bindings.js'
import { THEMES, getTheme, applyTheme } from './theme.js'
import { PageScroll } from './PageScroll.jsx'
import {
  getTerminalFontSize,
  setTerminalFontSize,
  TERMINAL_FONT_MIN,
  TERMINAL_FONT_MAX,
  TERMINAL_FONT_STEP,
} from './terminalFont.js'

// @@@ Settings - the settings PAGE (`,`, or the sidebar's bottom entry — #/settings, [[side-nav]]): a
// routed page like every other top-level surface, not a popup. It accretes sections (see the `settings`
// spec): today LANGUAGE, THEME and SHORTCUTS. The shortcuts section is the EDITABLE twin of the read-only
// help legend — both project the one keymap registry (keymap.js). A row's keyboard cell is clicked to
// capture the next key as that action's new binding (saved via bindings.js to localStorage); structural
// rows (nav, the n/d chords) are shown but fixed.
// (Game-controller mapping is NOT here — the pad binds to action ids in [[game-controller]]'s controller
// mode, so a key rebind never touches it.)

// Shortcuts editor — one row per action; a click on a rebindable cell captures the next keypress.
function Shortcuts({ t }) {
  const [tick, setTick] = useState(0)        // re-render after a binding changes
  const [cap, setCap] = useState(null)       // action id being captured, or null
  const refresh = () => setTick((n) => n + 1)

  // keyboard capture: grab the next real keypress as the binding (Esc cancels, bare modifiers ignored).
  useEffect(() => {
    if (!cap) return
    const onKey = (e) => {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') { setCap(null); return }
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
      setBinding(cap, { keys: [e.key] }); setCap(null); refresh()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cap])

  return (
    <section className="legend-sec">
      <div className="legend-h">{t('settings.secShortcuts')}</div>
      <div className="set-keys">
        {ACT.map((a) => (
          <div className="set-key-row" key={a.id}>
            <span className="legend-desc">{t(a.desc)}</span>
            <button
              className={`bind-cell${cap === a.id ? ' capturing' : ''}${a.rebind ? '' : ' fixed'}${isCustom(a.id) ? ' custom' : ''}`}
              disabled={!a.rebind}
              onClick={() => a.rebind && setCap(a.id)}
            >
              {cap === a.id ? <span className="bind-hint">{t('settings.bindPrompt')}</span>
                : keysOf(a.id).map((k, i) => <kbd key={i}>{keyCap(k)}</kbd>)}
            </button>
          </div>
        ))}
      </div>
      <div className="set-foot">
        <span className="legend-desc set-hint">{t('settings.shortcutsHint')}</span>
        <button className="set-reset" onClick={() => { resetBindings(); setCap(null); refresh() }}>{t('settings.reset')}</button>
      </div>
    </section>
  )
}

export default function Settings() {
  const { t, lang, setLang } = useI18n()
  const [theme, setThemeState] = useState(getTheme)   // the live-picked theme, echoed in the picker
  const [terminalFontSize, setTerminalFontSizeState] = useState(getTerminalFontSize)
  const pickTheme = (code) => { applyTheme(code); setThemeState(code) }
  const pickTerminalFontSize = (value) => setTerminalFontSizeState(setTerminalFontSize(value))
  return (
    <PageScroll className="page-settings-scroll">
      <div className="settings-body">
      <h1 className="page-title">{t('settings.title')}</h1>
      <section className="legend-sec">
        <div className="legend-h">{t('settings.secLanguage')}</div>
        <div className="set-langs">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              className={l.code === lang ? 'set-lang on' : 'set-lang'}
              onClick={() => setLang(l.code)}
              aria-pressed={l.code === lang}
            >
              {l.label}
            </button>
          ))}
        </div>
      </section>
      <section className="legend-sec">
        <div className="legend-h">{t('settings.secTheme')}</div>
        <div className="set-langs">
          {THEMES.map((th) => (
            <button
              key={th.code}
              className={th.code === theme ? 'set-lang on' : 'set-lang'}
              onClick={() => pickTheme(th.code)}
              aria-pressed={th.code === theme}
            >
              {t(th.label)}
            </button>
          ))}
        </div>
      </section>
      <section className="legend-sec">
        <div className="legend-h">{t('settings.secTerminal')}</div>
        <label className="set-terminal-font">
          <span>{t('settings.terminalFontSize')}</span>
          <input
            type="range"
            min={TERMINAL_FONT_MIN}
            max={TERMINAL_FONT_MAX}
            step={TERMINAL_FONT_STEP}
            value={terminalFontSize}
            onChange={(event) => pickTerminalFontSize(event.target.value)}
          />
          <output>{terminalFontSize}px</output>
        </label>
      </section>
      <Shortcuts t={t} />
      </div>
    </PageScroll>
  )
}
