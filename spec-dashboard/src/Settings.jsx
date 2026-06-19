import { useI18n, LANGUAGES } from './i18n/index.jsx'

// @@@ Settings - the centered settings popup, opened by the `,` hotkey (see App). It REUSES the
// legend/help modal chrome (.legend-backdrop/.legend/.legend-head/.legend-body/.legend-sec) so it
// looks and behaves identically — backdrop click closes, inner panel stops propagation, Esc/× close
// (Esc handled in App). Today it owns one setting, LANGUAGE; it's the deliberate home for future ones
// (just add another .legend-sec). The language list comes from i18n (LANGUAGES); picking one calls
// setLang, which persists to localStorage and re-renders every t() live — no reload.
export default function Settings({ onClose }) {
  const { t, lang, setLang } = useI18n()
  return (
    <div className="legend-backdrop" onClick={onClose}>
      <div className="legend settings" role="dialog" aria-modal="true" aria-label={t('settings.title')} onClick={(e) => e.stopPropagation()}>
        <div className="legend-head">
          <span className="legend-title">{t('settings.title')}</span>
          <button className="legend-close" onClick={onClose} title={t('settings.close')}>×</button>
        </div>
        <div className="legend-body">
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
        </div>
      </div>
    </div>
  )
}
