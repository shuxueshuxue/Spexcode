import { useEffect, useId, useState } from 'react'
import { useT } from './i18n/index.jsx'
import { Icon, IconButton } from './icons.jsx'
import {
  DEFAULT_GATEWAY_ICON, DEFAULT_PROJECT_ICON, IDENTITY_PRESETS, identityFaviconHref as faviconHref,
  identityPreset, isIconifyIcon,
} from '../../spec-cli/src/identity-presets.js'

export { DEFAULT_GATEWAY_ICON, DEFAULT_PROJECT_ICON, IDENTITY_PRESETS }
export const identityFaviconHref = faviconHref

const ICON_SOURCES = [
  { id: 'featured', label: 'projects.iconSourceFeatured' },
  { id: 'material', label: 'projects.iconSourceMaterial', prefixes: 'mdi,material-symbols' },
  { id: 'lucide', label: 'projects.iconSourceLucide', prefixes: 'lucide' },
  { id: 'tabler', label: 'projects.iconSourceTabler', prefixes: 'tabler' },
  { id: 'phosphor', label: 'projects.iconSourcePhosphor', prefixes: 'ph' },
  { id: 'brands', label: 'projects.iconSourceBrands', prefixes: 'simple-icons' },
]

const titleCase = (value) => value.split('-').filter(Boolean)
  .map((word) => word[0]?.toUpperCase() + word.slice(1)).join(' ')

function iconifyChoice(id, collections = {}) {
  const canonical = id.replace('/', ':')
  const [prefix, icon] = canonical.split(':')
  return { id: canonical, label: titleCase(icon), source: collections[prefix]?.name || prefix }
}

export function IdentityIcon({ icon, fallback = DEFAULT_PROJECT_ICON, size = 24, className, label }) {
  const preset = identityPreset(icon)
  if (!preset && isIconifyIcon(icon)) {
    return (
      <span
        className={className ? `identity-iconify ${className}` : 'identity-iconify'}
        style={{ width: size, height: size, maskImage: `url("${faviconHref(icon, fallback)}")`, WebkitMaskImage: `url("${faviconHref(icon, fallback)}")` }}
        role={label ? 'img' : undefined}
        aria-label={label || undefined}
        aria-hidden={label ? undefined : true}
      />
    )
  }
  if (!preset) {
    return <img width={size} height={size} src={faviconHref(icon, fallback)} className={className} alt={label || ''} aria-hidden={label ? undefined : true} />
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      <rect x="1" y="1" width="22" height="22" rx="5" fill={preset.bg} />
      <g fill="none" stroke={preset.fg} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {preset.shapes.map(({ tag: Shape, ...props }, i) => <Shape key={i} {...props} />)}
      </g>
    </svg>
  )
}

export function IdentityPicker({ value, onChange, label, editLabel, name, fallback = DEFAULT_PROJECT_ICON, disabled = false }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('featured')
  const [search, setSearch] = useState({ state: 'idle', choices: [] })
  const pickerId = useId()
  const current = identityPreset(value)
  const selectedSource = ICON_SOURCES.find((item) => item.id === source) || ICON_SOURCES[0]

  useEffect(() => {
    if (!open) return undefined
    const typed = query.trim()
    const searchQuery = typed.length >= 2 ? typed : source === 'featured' ? '' : 'project'
    if (!searchQuery) {
      setSearch({ state: 'idle', choices: [] })
      return undefined
    }
    const controller = new AbortController()
    setSearch({ state: 'loading', choices: [] })
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ query: searchQuery, limit: '48' })
        if (selectedSource.prefixes) params.set('prefixes', selectedSource.prefixes)
        const response = await fetch(`https://api.iconify.design/search?${params}`, { signal: controller.signal })
        if (!response.ok) throw new Error(`Iconify search answered ${response.status}`)
        const answer = await response.json()
        if (!Array.isArray(answer.icons)) throw new Error('Iconify search returned an invalid response')
        setSearch({
          state: 'ready',
          choices: answer.icons.filter(isIconifyIcon).map((id) => iconifyChoice(id, answer.collections)),
        })
      } catch (error) {
        if (error.name !== 'AbortError') setSearch({ state: 'error', choices: [] })
      }
    }, 220)
    return () => { clearTimeout(timer); controller.abort() }
  }, [open, query, source, selectedSource.prefixes])

  const resetAndClose = () => {
    setOpen(false)
    setQuery('')
    setSource('featured')
    setSearch({ state: 'idle', choices: [] })
  }

  const choose = async (next) => {
    const saved = await onChange(next)
    if (saved !== false) resetAndClose()
  }

  const localQuery = query.trim().toLowerCase()
  const featured = IDENTITY_PRESETS
    .filter((preset) => !localQuery || preset.label.toLowerCase().includes(localQuery) || preset.id.includes(localQuery))
    .map((preset) => ({ id: preset.id, label: preset.label, source: '' }))
  let choices = search.state === 'ready' ? search.choices : source === 'featured' ? featured : []
  if (isIconifyIcon(value) && !choices.some((choice) => choice.id === value.replace('/', ':'))) {
    choices = [iconifyChoice(value), ...choices]
  }

  return (
    <div className={open ? 'identity-control open' : 'identity-control'}>
      <div className="identity-disclosure">
        <IdentityIcon icon={value} fallback={fallback} size={26} label={`${label}: ${current?.label || value || fallback}`} />
        <IconButton
          icon="pencil"
          label={editLabel}
          className="proj-act icon identity-edit"
          size={13}
          disabled={disabled}
          aria-expanded={open}
          aria-controls={pickerId}
          onClick={() => { if (open) resetAndClose(); else setOpen(true) }}
        />
      </div>
      {open && (
        <fieldset id={pickerId} className="identity-picker" disabled={disabled}>
          <legend>{label}</legend>
          <div className="identity-search">
            <Icon name="search" size={14} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('projects.iconSearch')}
              aria-label={t('projects.iconSearch')}
              spellCheck={false}
            />
          </div>
          <div className="identity-sources" role="group" aria-label={t('projects.iconSources')}>
            {ICON_SOURCES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={source === item.id ? 'identity-source on' : 'identity-source'}
                aria-pressed={source === item.id}
                onClick={() => setSource(item.id)}
              >{t(item.label)}</button>
            ))}
          </div>
          <div className="identity-options">
            {choices.map((choice) => (
              <label key={choice.id} className="identity-choice">
                <input
                  type="radio"
                  name={name}
                  value={choice.id}
                  checked={value.replace('/', ':') === choice.id}
                  onChange={() => choose(choice.id)}
                />
                <IdentityIcon icon={choice.id} size={28} />
                <span className="identity-choice-name">{choice.label}</span>
                {choice.source && <span className="identity-choice-source">{choice.source}</span>}
              </label>
            ))}
          </div>
          {search.state === 'loading' && <div className="identity-search-status" role="status">{t('projects.iconSearching')}</div>}
          {search.state === 'ready' && !choices.length && <div className="identity-search-status">{t('projects.iconSearchEmpty')}</div>}
          {search.state === 'error' && <div className="identity-search-status error" role="alert">{t('projects.iconSearchFailed')}</div>}
        </fieldset>
      )}
    </div>
  )
}
