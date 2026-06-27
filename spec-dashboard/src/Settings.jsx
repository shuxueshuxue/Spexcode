import Modal from './Modal.jsx'
import { useI18n, LANGUAGES } from './i18n/index.jsx'

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
    </Modal>
  )
}
