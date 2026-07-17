import { useT } from './i18n/index.jsx'

// the session-mode segmented switch ([[launcher-select]]'s headless axis) — ⌨ interactive | ◇ headless —
// shared verbatim by the desktop pop card (SessionInterface's LauncherPicker) and the phone composer
// (MobileNewSession); only CSS sizes it per surface. aria-pressed marks the active segment and ←/→ flip
// it from the keyboard. `headlessOk` says whether the SELECTED launcher offers headless (its backend
// `modes`); when it doesn't, the ◇ segment greys with the config-repair tooltip but STAYS clickable —
// the pick fires and useLaunchers bounces it back to interactive with a visible notice, so the refusal
// is loud, never a dead button the human can't interrogate.
export default function ModeToggle({ mode, pickMode, headlessOk }) {
  const t = useT()
  const onKey = (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); pickMode('interactive') }
    else if (e.key === 'ArrowRight') { e.preventDefault(); pickMode('headless') }
  }
  return (
    <div className="si-mode-toggle" role="group" aria-label={t('session.modeLabel')} onKeyDown={onKey}>
      <button
        type="button"
        className={mode === 'interactive' ? 'si-mode-seg on' : 'si-mode-seg'}
        aria-pressed={mode === 'interactive'}
        onClick={() => pickMode('interactive')}
      >
        <span className="si-mode-glyph" aria-hidden="true">⌨</span>{t('session.modeInteractive')}
      </button>
      <button
        type="button"
        className={`si-mode-seg${mode === 'headless' ? ' on' : ''}${headlessOk ? '' : ' dim'}`}
        aria-pressed={mode === 'headless'}
        data-tip={headlessOk ? undefined : t('session.modeUnavailableTip')}
        onClick={() => pickMode('headless')}
      >
        <span className="si-mode-glyph" aria-hidden="true">◇</span>{t('session.modeHeadless')}
      </button>
    </div>
  )
}
