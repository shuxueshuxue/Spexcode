import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IconButton } from './icons.jsx'
import { useI18n } from './i18n/index.jsx'
import { useEscLayer } from './escStack.js'
import { returnFocus } from './focus.js'
import { useFold } from './useFold.js'
import { ALL_FILTER, UPLOADED_FILTER, matchResources, resourceFilters } from './resourceCatalog.js'

// How long the closing drawer stays mounted: the close is a fade (`--dur-rise`), not the drawer in reverse.
const CLOSE_MS = 140

const TYPE_MARK = {
  html: ['file-code', 'orange'], pdf: ['file-text', 'red'], markdown: ['file-text', 'blue'],
  image: ['file-image', 'magenta'], text: ['file-text', 'muted'], json: ['file-json', 'yellow'],
  csv: ['file-spreadsheet', 'green'], video: ['file-video', 'cyan'], archive: ['file-archive', 'muted'],
  web: ['globe', 'cyan'],
}
const OTHER_MARK = ['file', 'muted']

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const uploadTime = (time, lang) => {
  const date = new Date(time)
  const options = sameDay(date, new Date())
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
  return new Intl.DateTimeFormat(lang, options).format(date)
}

// [[resource-picker]]: the floating door to everything a session has published.
export default function ResourcePicker({ entries, openIds, open, onOpenChange, onPick, onDownload, onCopy }) {
  const { t, lang } = useI18n()
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [mounted, closing] = useFold(open, reducedMotion ? 0 : CLOSE_MS)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState(ALL_FILTER)
  const [cursor, setCursor] = useState(0)
  // Every opening starts from the whole list. Reset during the render that opens it, so the drawer's first
  // frame never shows the previous opening's search.
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) { setQuery(''); setFilter(ALL_FILTER); setCursor(0) }
  }
  const rootRef = useRef(null)
  const searchRef = useRef(null)
  const listRef = useRef(null)
  const closeRef = useRef(null)
  closeRef.current = () => onOpenChange(false)

  const filters = useMemo(() => resourceFilters(entries), [entries])
  const activeFilter = filters.some((chip) => chip.id === filter) ? filter : ALL_FILTER
  const rows = useMemo(() => matchResources(entries, { filter: activeFilter, query }), [entries, activeFilter, query])
  const current = Math.min(cursor, Math.max(0, rows.length - 1))

  // An opening puts focus in the search field; a close that finds focus still inside hands it back to
  // whatever held it before the picker took it.
  useEffect(() => {
    if (!open) {
      if (rootRef.current?.contains(document.activeElement)) { document.activeElement.blur(); returnFocus() }
      return undefined
    }
    const frame = requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [open])
  useEffect(() => { setCursor(0) }, [query, activeFilter])
  useEffect(() => {
    listRef.current?.querySelector('[data-cursor]')?.scrollIntoView?.({ block: 'nearest' })
  }, [current, rows])

  useEscLayer(open, () => closeRef.current())
  // A press anywhere else dismisses it, and so does focus leaving the page — which is also the only signal a
  // press inside a same-origin web resource's frame sends up.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => { if (!rootRef.current?.contains(event.target)) closeRef.current() }
    const onBlur = () => closeRef.current()
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [open])

  const onSearchKey = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor(Math.max(0, Math.min(rows.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))))
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing && rows[current]) {
      event.preventDefault()
      onPick(rows[current])
    }
  }
  const typeLabel = (entry) => t(`session.resourceType.${entry.type || 'other'}`)

  return (
    <div className="si-rp" ref={rootRef}>
      <button type="button" className={`si-rp-fab${open ? ' on' : ''}${entries.length ? '' : ' empty'}`}
        data-action="resource-picker" data-tip={t('session.addResourceTab')} aria-label={t('session.addResourceTab')}
        aria-haspopup="dialog" aria-expanded={open} onClick={() => onOpenChange(!open)}>
        <Icon name="folder-open" size={15} />
        {entries.length > 0 && <span className="si-rp-count">{entries.length}</span>}
      </button>
      {mounted && (
        <div className="si-rp-slot">
        <div className={`si-rp-drawer${closing ? ' closing' : ''}`} role="dialog" aria-label={t('session.resourceMenuLabel')}
          data-focus-overlay>
          <header className="si-rp-head">{t('session.resourcePickerTitle')}</header>
          <label className="si-rp-search">
            <Icon name="search" size={13} />
            <input ref={searchRef} value={query} spellCheck={false} autoComplete="off"
              placeholder={t('session.resourceSearch')} aria-label={t('session.resourceSearch')}
              onChange={(event) => setQuery(event.target.value)} onKeyDown={onSearchKey} />
            {query && <IconButton icon="x" size={12} className="si-rp-clear" label={t('session.resourceSearchClear')}
              onClick={() => { setQuery(''); searchRef.current?.focus() }} />}
          </label>
          {filters.length > 1 && (
            <div className="si-rp-chips" role="radiogroup" aria-label={t('session.resourceFilterLabel')}>
              {filters.map((chip) => (
                <button key={chip.id} type="button" role="radio" aria-checked={chip.id === activeFilter}
                  className={`si-rp-chip${chip.id === activeFilter ? ' on' : ''}${chip.id === UPLOADED_FILTER ? ' is-uploaded' : ''}`}
                  data-filter={chip.id} onClick={() => setFilter(chip.id)}>
                  {chip.id === UPLOADED_FILTER && <Icon name="paperclip" size={11} />}
                  <span>{t(`session.resourceType.${chip.id}`)}</span>
                  <span className="si-rp-chip-count">{chip.count}</span>
                </button>
              ))}
            </div>
          )}
          <div className="si-rp-list" ref={listRef} role="list">
            {rows.map((entry, index) => {
              const [mark, tone] = TYPE_MARK[entry.type] || OTHER_MARK
              const uploaded = entry.uploadedAt != null
              return (
                <div key={entry.id} role="listitem" className={`si-rp-row${index === current ? ' cursor' : ''}`}
                  data-cursor={index === current || undefined} data-resource={entry.id} onMouseMove={() => { if (index !== current) setCursor(index) }}>
                  <button type="button" className="si-rp-open" onClick={() => onPick(entry)}>
                    <span className={`si-rp-mark tone-${tone}`}><Icon name={mark} size={16} /></span>
                    <span className="si-rp-text">
                      <span className="si-rp-name">{entry.label}</span>
                      <span className="si-rp-meta">
                        <span>{typeLabel(entry)}</span>
                        {entry.folder && <span className="si-rp-folder">{entry.folder}</span>}
                        {uploaded && <span className="si-rp-tag"><Icon name="paperclip" size={10} />{t('session.resourceUploadedTag')}</span>}
                        {uploaded && <time dateTime={new Date(entry.uploadedAt).toISOString()}>{uploadTime(entry.uploadedAt, lang)}</time>}
                      </span>
                    </span>
                    {openIds.has(entry.id) && <span className="si-rp-state">{t('session.resourceOpenTag')}</span>}
                  </button>
                  {entry.kind === 'file' && (
                    <span className="si-rp-tools">
                      <IconButton icon="download" size={13} className="si-rp-tool" label={t('session.downloadFile')} onClick={() => onDownload(entry)} />
                      <IconButton icon="copy" size={13} className="si-rp-tool" label={entry.value} onClick={() => onCopy(entry)} />
                    </span>
                  )}
                </div>
              )
            })}
            {!entries.length && (
              <div className="si-rp-empty">
                <Icon name="folder-open" size={22} />
                <strong>{t('session.resourceEmptyTitle')}</strong>
                <span>{t('session.resourceEmptyHint')}</span>
              </div>
            )}
            {entries.length > 0 && !rows.length && <div className="si-rp-empty"><strong>{t('session.resourceNoMatch')}</strong></div>}
          </div>
        </div>
        </div>
      )}
    </div>
  )
}
