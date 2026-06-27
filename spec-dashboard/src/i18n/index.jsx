import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import en from './en.js'
import zh from './zh.js'

const DICTS = { en, zh }
const LANG_KEY = 'spexcode.lang'   // localStorage key holding the explicit user choice

// the languages the Settings popup offers. `label` is shown in the user's OWN script (English / 中文),
// never translated, so a reader can always find their language regardless of the current locale.
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
]

// browser default → a supported code. Only the primary subtag matters (zh-CN / zh-TW / zh → 'zh').
function detect() {
  const nav = (typeof navigator !== 'undefined' && navigator.language || 'en').toLowerCase()
  if (nav.startsWith('zh')) return 'zh'
  return 'en'
}

function initialLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved && DICTS[saved]) return saved
  } catch { /* localStorage may be unavailable (private mode) — fall through to detection */ }
  return detect()
}

// walk a dotted path ('legend.board.move') into a nested dict; undefined if any segment is missing. A
// non-string key (a caller passed t(undefined) — e.g. a label map missing an entry) resolves to undefined
// too, so translate() degrades to the visible-key path instead of throwing and taking the whole tree down.
function resolve(dict, key) {
  if (typeof key !== 'string') return undefined
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dict)
}

// fill `{name}` placeholders from params; an unmatched placeholder is left visible so a missing param
// fails loudly rather than silently vanishing.
function interpolate(str, params) {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? params[k] : `{${k}}`))
}

// a dict value may be a plain string (interpolated) or a (params)=>string function for count-sensitive copy.
function translate(dict, key, params) {
  let v = resolve(dict, key)
  if (v === undefined) v = resolve(en, key)        // graceful per-key fallback to the source locale
  if (typeof v === 'function') return v(params || {})
  if (typeof v === 'string') return interpolate(v, params)
  return key
}

const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(initialLang)

  // reflect the choice onto <html lang> (a11y / browser) and persist it as the explicit override.
  useEffect(() => {
    try { document.documentElement.lang = lang } catch { /* no DOM (tests) */ }
  }, [lang])

  const setLang = useCallback((next) => {
    if (!DICTS[next]) return
    try { localStorage.setItem(LANG_KEY, next) } catch { /* persistence is best-effort */ }
    setLangState(next)
  }, [])

  const value = useMemo(() => {
    const dict = DICTS[lang] || en
    return { lang, setLang, t: (key, params) => translate(dict, key, params) }
  }, [lang, setLang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within <I18nProvider>')
  return ctx
}

// the common case: just the translator. `const t = useT()` then `t('key')`.
export function useT() {
  return useI18n().t
}
