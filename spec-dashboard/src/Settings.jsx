import { useEffect, useState } from 'react'
import Modal from './Modal.jsx'
import { useI18n, LANGUAGES } from './i18n/index.jsx'
import { ACT, keyCap, padCap } from './keymap.js'
import { keysOf, padOf, isCustom, setBinding, resetBindings } from './bindings.js'
import { getStatus, subscribeStatus, captureButton } from './gamepad.js'

// @@@ Settings - the centered settings popup (`,`), rendered in the shared Modal so it matches the help
// modal. It accretes sections (see the `settings` spec): today LANGUAGE and SHORTCUTS & CONTROLLER. The
// shortcuts section is the EDITABLE twin of the read-only help legend — both project the one keymap
// registry (keymap.js). A row's keyboard cell or controller cell is clicked to capture the next key /
// button as that action's new binding (saved via bindings.js to localStorage); structural rows (nav, the
// n/d chords) are shown but fixed. A live line reports whether a controller is connected.

// Shortcuts editor — one row per action; a click on a rebindable cell captures the next key/button.
function Shortcuts({ t }) {
  const [tick, setTick] = useState(0)        // re-render after a binding changes
  const [cap, setCap] = useState(null)       // { id, kind: 'key' | 'pad' } while capturing
  const [status, setStatus] = useState(getStatus())
  const refresh = () => setTick((n) => n + 1)

  useEffect(() => subscribeStatus(setStatus), [])

  // keyboard capture: grab the next real keypress as the binding (Esc cancels, bare modifiers ignored).
  useEffect(() => {
    if (cap?.kind !== 'key') return
    const onKey = (e) => {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') { setCap(null); return }
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
      setBinding(cap.id, { keys: [e.key] }); setCap(null); refresh()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cap])

  // controller capture: watch for the next button / stick direction.
  useEffect(() => {
    if (cap?.kind !== 'pad') return
    const cancel = captureButton((token) => { setBinding(cap.id, { pad: token }); setCap(null); refresh() })
    return cancel
  }, [cap])

  const capturing = (id, kind) => cap && cap.id === id && cap.kind === kind

  return (
    <section className="legend-sec">
      <div className="legend-h legend-keymap-h">
        <span>{t('settings.secShortcuts')}</span>
        <span className={status.connected ? 'pad-status on' : 'pad-status'}>
          {status.connected ? t('settings.padOn') : t('settings.padOff')}
        </span>
      </div>
      <div className="set-keys">
        {ACT.map((a) => (
          <div className="set-key-row" key={a.id}>
            <span className="legend-desc">{t(a.desc)}</span>
            <button
              className={`bind-cell${capturing(a.id, 'key') ? ' capturing' : ''}${a.rebind ? '' : ' fixed'}${isCustom(a.id) ? ' custom' : ''}`}
              disabled={!a.rebind}
              onClick={() => a.rebind && setCap({ id: a.id, kind: 'key' })}
            >
              {capturing(a.id, 'key') ? <span className="bind-hint">{t('settings.bindPrompt')}</span>
                : keysOf(a.id).map((k, i) => <kbd key={i}>{keyCap(k)}</kbd>)}
            </button>
            <button
              className={`bind-cell${capturing(a.id, 'pad') ? ' capturing' : ''}${a.rebind ? '' : ' fixed'}`}
              disabled={!a.rebind}
              onClick={() => a.rebind && setCap({ id: a.id, kind: 'pad' })}
            >
              {capturing(a.id, 'pad') ? <span className="bind-hint">{t('settings.bindPromptPad')}</span>
                : padOf(a.id) ? <kbd className="pad">{padCap(padOf(a.id))}</kbd> : <span className="pad-none">—</span>}
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

export default function Settings({ onClose }) {
  const { t, lang, setLang } = useI18n()
  return (
    <Modal title={t('settings.title')} closeLabel={t('settings.close')} className="settings" onClose={onClose}>
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
        <div className="legend-desc set-hint">{t('settings.languageHint')}</div>
      </section>
      <Shortcuts t={t} />
    </Modal>
  )
}
