import { useEffect, useId, useRef, useState } from 'react'
import { Icon, IconButton } from './icons.jsx'
import { useT } from './i18n/index.jsx'
import { useEscLayer } from './escStack.js'
import { scanQuery, suggestAt } from './reviewQuery.js'
import { PageScroll } from './PageScroll.jsx'

// The ONE review vocabulary ([[review-chrome]]): both ListViews consume the same query, section, facet,
// overflow, row, and state primitives; both detail pages consume the same standalone shell.

export const REVIEW_STATE_VISUALS = {
  issue: {
    open: { icon: 'issue-opened', tone: 'open', label: 'reviewState.issueOpen' },
    closed: { icon: 'issue-closed', tone: 'closed', label: 'reviewState.issueClosed' },
  },
  eval: {
    pass: { icon: 'circle-check', tone: 'pass', label: 'score.pass' },
    fail: { icon: 'circle-x', tone: 'fail', label: 'score.fail' },
    stalePass: { icon: 'circle-check', tone: 'stale', label: 'score.stalePass' },
    staleFail: { icon: 'circle-x', tone: 'stale', label: 'score.staleFail' },
    empty: { icon: 'circle-minus', tone: 'empty', label: 'score.empty' },
    missing: { icon: 'circle-dashed', tone: 'empty', label: 'score.missing' },
    legacy: { icon: 'circle-minus', tone: 'empty', label: 'score.empty' },
  },
}

export const reviewStateVisual = (kind, state) => {
  const normalized = kind === 'issue' ? (state === 'open' ? 'open' : 'closed') : (state || 'empty')
  return REVIEW_STATE_VISUALS[kind]?.[normalized] || REVIEW_STATE_VISUALS.eval.empty
}

export function ReviewState({ kind, state, showLabel = false, size = 16, className = '', title }) {
  const t = useT()
  const visual = reviewStateVisual(kind, state)
  const label = title || t(visual.label)
  return (
    <span className={`review-state ${kind} ${visual.tone} ${className}`} data-tip={label} aria-label={label}>
      <span className="review-state-icon" style={{ width: size, height: size }}><Icon name={visual.icon} size={size} /></span>
      {showLabel && <span className="review-state-label">{label}</span>}
    </span>
  )
}

// the embedded surfaces' local-state reducer ([[review-filters]]): merge a patch, dropping emptied keys.
// The CANONICAL pages never use this — their one state is the visible token text ([[review-query]]).
export function nextQuery(query, patch) {
  const next = { ...query, ...patch }
  for (const [key, value] of Object.entries(next)) if (value == null || value === '') delete next[key]
  return next
}

export const listEmptyText = (empty) => (
  empty && typeof empty === 'object'
    ? (empty.hasData ? empty.filtered : empty.dataset)
    : empty
)

export const facetMenuOptions = (options, value, clearLabel) => {
  const supplied = Array.isArray(options) ? options : []
  const active = value != null && String(value) !== ''
  if (!active || clearLabel == null || supplied.some((option) => String(option.value) === '')) return supplied
  return [{ value: '', label: clearLabel }, ...supplied]
}

export const rovingIndex = (index, length, key) => {
  if (!length) return -1
  if (key === 'Home') return 0
  if (key === 'End') return length - 1
  if (key === 'ArrowDown' || key === 'ArrowRight') return index < 0 ? 0 : (index + 1) % length
  if (key === 'ArrowUp' || key === 'ArrowLeft') return index < 0 ? length - 1 : (index - 1 + length) % length
  return index
}

export const listOwnsKey = (target, key) => {
  const tag = target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false
  if (tag === 'BUTTON' && (key === 'Enter' || key === ' ')) return false
  if (key === 'Enter' && target?.closest?.('a[href]')) return false
  return key === 'j' || key === 'k' || key === 'Enter'
}

const visibleMenuItems = (menu) => [...(menu?.querySelectorAll('[role="menuitemradio"]') || [])]
  .filter((item) => item.getClientRects().length > 0)

const focusMenuItem = (items, index) => {
  const target = items[index]
  if (!target) return
  for (const item of items) item.tabIndex = item === target ? 0 : -1
  target.focus()
}

// the ONE accessible popover mechanics (menu focus discipline, roving menuitemradio, LIFO Esc, outside
// dismiss) — shared by the facet menus here and by any detail-context overflow (the A/B strip's).
export function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const menuRef = useRef(null)
  const triggerRef = useRef(null)
  const initialFocus = useRef('checked')

  const close = (restoreFocus = false) => {
    if (restoreFocus) triggerRef.current?.focus()
    setOpen(false)
  }

  const openMenu = (trigger, preferred = 'checked') => {
    triggerRef.current = trigger
    initialFocus.current = preferred
    setOpen(true)
  }

  const toggle = (trigger) => {
    if (open) close(false)
    else openMenu(trigger)
  }

  useEscLayer(open, () => close(true))

  useEffect(() => {
    if (!open) return undefined
    const dismiss = (event) => { if (!ref.current?.contains(event.target)) close(false) }
    window.addEventListener('pointerdown', dismiss, true)
    return () => window.removeEventListener('pointerdown', dismiss, true)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const frame = requestAnimationFrame(() => {
      const items = visibleMenuItems(menuRef.current)
      const checked = items.findIndex((item) => item.getAttribute('aria-checked') === 'true')
      const index = initialFocus.current === 'last'
        ? items.length - 1
        : initialFocus.current === 'first' ? 0 : (checked >= 0 ? checked : 0)
      focusMenuItem(items, index)
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  const onTriggerKeyDown = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    event.stopPropagation()
    openMenu(event.currentTarget, event.key === 'ArrowUp' ? 'last' : 'first')
  }

  const onMenuKeyDown = (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = visibleMenuItems(menuRef.current)
    const index = items.indexOf(document.activeElement)
    event.preventDefault()
    event.stopPropagation()
    focusMenuItem(items, rovingIndex(index, items.length, event.key))
  }

  const onItemFocus = (event) => {
    const items = visibleMenuItems(menuRef.current)
    focusMenuItem(items, items.indexOf(event.currentTarget))
  }

  return { open, ref, menuRef, close, toggle, onTriggerKeyDown, onMenuKeyDown, onItemFocus }
}

export function FacetMenu({ label, value = '', options = [], onChange, mobile = false, clearLabel }) {
  const popover = usePopover()
  const usable = facetMenuOptions(options, value, clearLabel)
  if (!usable.length) return null
  const active = usable.find((option) => String(option.value) === String(value))
  const selectedLabel = value ? (active?.label || String(value)) : ''
  return (
    <div className={`rl-facet-wrap ${mobile ? 'mobile-stay' : ''}`} ref={popover.ref}>
      <button type="button" className={`rl-facet ${value ? 'active' : ''}`} aria-haspopup="menu" aria-expanded={popover.open}
        onClick={(event) => popover.toggle(event.currentTarget)} onKeyDown={popover.onTriggerKeyDown}>
        <span>{selectedLabel ? `${label}: ${selectedLabel}` : label}</span>
        <Icon name="chevron-down" size={12} />
      </button>
      {popover.open && (
        <div className="rl-menu" role="menu" aria-label={label} ref={popover.menuRef} onKeyDown={popover.onMenuKeyDown}>
          {usable.map((option) => (
            <button type="button" role="menuitemradio" aria-checked={String(option.value) === String(value)}
              tabIndex={-1} key={String(option.value)} className="rl-menu-item" onFocus={popover.onItemFocus}
              // close(true) is only the NO-OP fallback: a pick that changes the committed text re-parks
              // focus in the query input (the continuable-edit replay); an unchanged pick keeps its trigger.
              onClick={() => { popover.close(true); onChange(option.value) }}>
              <Icon name={String(option.value) === String(value) ? 'check' : 'blank'} size={13} />
              <span>{option.label}</span>
              {option.count != null && <span className="rl-menu-count">{option.count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function FacetOverflow({ label, groups = [], clearLabel, icon = 'ellipsis', className = '' }) {
  const groupId = useId()
  const usable = groups
    .map((group) => ({ ...group, options: facetMenuOptions(group.options, group.value, group.clearLabel === null ? null : (group.clearLabel || clearLabel)) }))
    .filter((group) => group.options.length)
  const hasDesktop = usable.some((group) => !group.mobileOnly)
  const hasActive = usable.some((group) => group.active ?? (group.value != null && String(group.value) !== ''))
  const popover = usePopover()
  if (!usable.length) return null
  return (
    <div className={`rl-overflow ${hasDesktop ? '' : 'mobile-only'} ${hasActive ? 'active' : ''} ${className}`} ref={popover.ref}>
      <IconButton icon={icon} size={16} className="rl-overflow-btn" label={label}
        aria-haspopup="menu" aria-expanded={popover.open} onClick={(event) => popover.toggle(event.currentTarget)}
        onKeyDown={popover.onTriggerKeyDown} />
      {popover.open && (
        <div className="rl-menu rl-overflow-menu" role="menu" aria-label={label} ref={popover.menuRef} onKeyDown={popover.onMenuKeyDown}>
          {usable.map((group, index) => (
            <div key={`${group.label}-${group.mobileOnly ? 'mobile' : 'all'}`} role="group"
              aria-labelledby={`${groupId}-group-${index}`} className={`rl-menu-group ${group.mobileOnly ? 'mobile-only' : ''}`}>
              <div className="rl-menu-label" id={`${groupId}-group-${index}`}>{group.label}</div>
              {group.options.map((option) => (
                <button type="button" role="menuitemradio" aria-checked={String(option.value) === String(group.value || '')}
                  tabIndex={-1} key={String(option.value)} className="rl-menu-item" onFocus={popover.onItemFocus}
                  onClick={() => { popover.close(true); group.onChange(option.value) }}>
                  <Icon name={String(option.value) === String(group.value || '') ? 'check' : 'blank'} size={13} />
                  <span>{option.label}</span>
                  {option.count != null && <span className="rl-menu-count">{option.count}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ReviewListRow({ state, title, meta, aside }) {
  return (
    <div className="rl-row-grid">
      <div className="rl-row-state">{state}</div>
      <div className="rl-row-body">
        <div className="rl-row-title">{title}</div>
        {meta && <div className="rl-row-meta">{meta}</div>}
      </div>
      {aside && <div className="rl-row-aside">{aside}</div>}
    </div>
  )
}

// The token query combobox ([[review-query]] is the engine; the chrome is GitHub-measured): ONE native
// input whose raw text is the whole list state, an aria-hidden syntax-highlight overlay UNDER it —
// recognized qualifiers color, unknown ones stay honestly plain; the input's own glyphs are transparent
// so caret/selection/editing stay native, never contenteditable — and a bounded inline-autocomplete
// listbox: a KEY pick completes `key:` in place and typing continues, a VALUE pick completes the token
// and submits immediately. Plain Enter submits the typed text verbatim.

// a committed text replays as a CONTINUABLE edit: the visible value is the trimmed tokens plus exactly
// ONE trailing ASCII space, so the parked caret already sits where the next token starts. Display-only —
// submit trims the outer whitespace back off, and the URL never carries it.
export const continuableText = (text) => {
  const t = String(text ?? '').trim()
  return t ? `${t} ` : ''
}

export function TokenQueryInput({ value = '', onSubmit, placeholder, label, keys = [], suggest = {} }) {
  const [draft, setDraft] = useState(() => continuableText(value))
  const [caret, setCaret] = useState(-1)      // -1 = suggestions closed
  const [active, setActive] = useState(-1)    // listbox cursor; -1 = typing, Enter submits
  const inputRef = useRef(null)
  const hlRef = useRef(null)
  const listId = useId()
  const seen = useRef(null)   // last committed value this instance replayed (null = cold)
  const parkCaret = (focus) => requestAnimationFrame(() => {
    const input = inputRef.current
    if (!input) return
    if (focus) input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  })
  // every committed replay — mount, builder push, hand submit, Back/Forward — re-seeds the continuable
  // form with the caret parked at the end. Only a CHANGED committed value takes focus (the user just
  // acted, or walked history, and keeps typing); a cold load parks the caret without stealing page
  // focus. The value compare — not a boolean — keeps StrictMode's replayed mount effect cold too.
  useEffect(() => {
    setDraft(continuableText(value)); setCaret(-1); setActive(-1)
    parkCaret(seen.current !== null && seen.current !== value)
    seen.current = value
  }, [value])
  const sug = caret >= 0 ? suggestAt(draft, caret, keys, suggest) : { start: 0, end: 0, items: [] }
  const open = sug.items.length > 0
  useEscLayer(open, () => setCaret(-1))
  const syncScroll = () => { if (hlRef.current && inputRef.current) hlRef.current.scrollLeft = inputRef.current.scrollLeft }
  useEffect(syncScroll)
  // submit hands the ENGINE the trimmed text (default-equivalent → bare address, else ?q= with no
  // outer whitespace) and re-seeds the visible value's continuable form even when the URL is unchanged —
  // including the emptied submit, which refills from the COMMITTED text (the page re-commits the
  // default, but an unchanged address never re-fires the [value] replay).
  const submit = (text) => {
    setCaret(-1); setActive(-1)
    const trimmed = text.trim()
    setDraft(continuableText(trimmed) || continuableText(value))
    parkCaret(true)
    onSubmit(trimmed)
  }
  const pick = (item) => {
    const next = `${draft.slice(0, sug.start)}${item.insert}${draft.slice(sug.end)}`
    setDraft(next)
    if (item.type === 'value') { submit(next); return }
    const pos = sug.start + item.insert.length
    setCaret(pos)
    setActive(-1)
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(pos, pos) })
  }
  return (
    <form className="rl-query rq" role="search" onSubmit={(event) => { event.preventDefault(); submit(draft) }}>
      <div className="rq-wrap">
        <div className="rq-hl" aria-hidden="true" ref={hlRef}>
          {scanQuery(draft).map((seg, index) => (
            seg.ws || seg.key == null || !keys.includes(seg.key)
              ? <span key={index}>{seg.raw}</span>
              : (
                <span key={index} className="rq-tok">
                  <span className="rq-tok-key">{seg.raw.slice(0, seg.key.length + 1)}</span>
                  <span className="rq-tok-val">{seg.raw.slice(seg.key.length + 1)}</span>
                </span>
              )
          ))}
        </div>
        <input ref={inputRef} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-o${active}` : undefined}
          value={draft} spellCheck={false} autoComplete="off" placeholder={placeholder} aria-label={label}
          onChange={(event) => { setDraft(event.target.value); setCaret(event.target.selectionStart ?? event.target.value.length); setActive(-1) }}
          onScroll={syncScroll}
          onKeyDown={(event) => {
            if (!open) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setActive(rovingIndex(active, sug.items.length, event.key))
            } else if (event.key === 'Enter' && active >= 0) {
              event.preventDefault()
              pick(sug.items[active])
            }
          }}
          onBlur={() => setCaret(-1)} />
      </div>
      {open && (
        <div className="rl-menu rq-list" role="listbox" id={listId} aria-label={label}>
          {sug.items.map((item, index) => (
            <div key={item.insert} id={`${listId}-o${index}`} role="option" aria-selected={index === active}
              className={`rq-opt ${index === active ? 'active' : ''}`}
              onPointerDown={(event) => { event.preventDefault(); pick(item) }}>
              <span className="rq-opt-token">{item.insert.trim()}</span>
              {item.label && item.label !== item.value && <span className="rq-opt-label">{item.label}</span>}
            </div>
          ))}
        </div>
      )}
      <button type="submit" className="rl-query-submit" data-tip={label} aria-label={label}><Icon name="search" size={16} /></button>
    </form>
  )
}

// Spec Information's compact projection of the same review filter mechanism: direct typing plus the
// existing accessible overflow popover. It owns no parser, predicate, or modal-only interaction state.
// `summary` ({shown, total}) leads the row with the ONE result count — "showing X of Y" on desktop,
// bare X/Y under the phone breakpoint (the aria-label keeps the words) — so the filter row's leading
// space states what the current view yields without repeating the caption's state tallies.
export function CompactReviewFilter({ value = '', onChange, placeholder, searchLabel, filterLabel, groups, clearLabel, clearSearchLabel, summary }) {
  const t = useT()
  const box = (
    <div className="rf-compact" role="search">
      <span className="rf-search-icon"><Icon name="search" size={13} /></span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={searchLabel} />
      {value && <IconButton icon="x" size={12} className="rf-clear" label={clearSearchLabel} onClick={() => onChange('')} />}
      <FacetOverflow label={filterLabel} clearLabel={clearLabel} groups={groups} icon="filter" className="rf-overflow" />
    </div>
  )
  if (!summary) return box
  const label = t('reviewList.showing', { shown: summary.shown, total: summary.total })
  return (
    <div className="rf-row">
      {/* the sentence rides a real (visually hidden) text node — robust where aria-label on a generic
          span is not — while the visible spans stay presentation-only. */}
      <span className="rf-summary" data-tip={label}>
        <span className="sr-only">{label}</span>
        <span className="rf-summary-full" aria-hidden="true">{label}</span>
        <span className="rf-summary-compact" aria-hidden="true">{summary.shown}/{summary.total}</span>
      </span>
      {box}
    </div>
  )
}

// ListPage is the measured GitHub ListView skeleton: title/action, 32px query, one bordered container with
// a 48px metadata bar, structured anchor rows, and an empty state. Pages supply domain data only.
export function ListPage({ notice, error, title, action, search, sections = [], sectionMode = 'tabs', facets, overflow, rows, empty, children }) {
  const [cur, setCur] = useState(null)
  const tabsId = useId()
  const stateRef = useRef({})
  stateRef.current = { rows, cur }
  useEffect(() => {
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || !listOwnsKey(event.target, event.key)) return
      const nav = stateRef.current.rows.filter((row) => row.href)
      if (!nav.length) return
      if (event.key === 'Enter') {
        const row = nav.find((item) => item.key === stateRef.current.cur)
        if (row) { event.preventDefault(); event.stopPropagation(); window.location.hash = row.href }
        return
      }
      event.preventDefault(); event.stopPropagation()
      const index = nav.findIndex((row) => row.key === stateRef.current.cur)
      const next = index < 0 ? (event.key === 'j' ? 0 : nav.length - 1) : Math.max(0, Math.min(nav.length - 1, index + (event.key === 'j' ? 1 : -1)))
      setCur(nav[next].key)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  useEffect(() => { document.querySelector('.lp-row.cur')?.scrollIntoView({ block: 'nearest' }) }, [cur])
  const emptyText = listEmptyText(empty)
  // the tablist ALWAYS exposes one roving tab stop: if a consumer marks no section active (a committed
  // text with no section token), the FIRST tab keeps tabIndex=0 and labels the one results panel.
  const activeSectionIndex = Math.max(0, sections.findIndex((section) => section.active))
  const sectionsAreTabs = sectionMode === 'tabs'
  const panelId = `${tabsId}-panel`
  const tabId = (index) => `${tabsId}-tab-${index}`
  return (
    <PageScroll className="lp-page">
      {notice && <div className="fv-notice">{notice}</div>}
      <div className="rl-content">
        <div className="rl-titlebar">
          <h1>{title}</h1>
          {action}
        </div>
        {search && <TokenQueryInput {...search} />}
        {error && <div className="fv-error lp-error" role="alert">{error}</div>}
        <section className="rl-list">
          <header className="lp-head">
            <div className="rl-sections" role={sectionsAreTabs ? 'tablist' : 'group'} aria-label={title}
              {...(sectionsAreTabs ? { 'aria-orientation': 'horizontal' } : {})}>
              {sections.map((section, index) => (
                <button type="button" role={sectionsAreTabs ? 'tab' : undefined}
                  aria-selected={sectionsAreTabs ? section.active : undefined}
                  aria-pressed={sectionsAreTabs ? undefined : section.active}
                  aria-controls={sectionsAreTabs ? panelId : undefined}
                  id={sectionsAreTabs ? tabId(index) : undefined} key={section.key}
                  tabIndex={sectionsAreTabs ? (index === activeSectionIndex ? 0 : -1) : undefined}
                  className={`rl-section ${section.active ? 'active' : ''}`}
                  onClick={section.onSelect} onKeyDown={(event) => {
                    if (!sectionsAreTabs) return
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                    const tabs = [...event.currentTarget.closest('[role="tablist"]').querySelectorAll('[role="tab"]')]
                    const next = rovingIndex(tabs.indexOf(event.currentTarget), tabs.length, event.key)
                    event.preventDefault()
                    event.stopPropagation()
                    tabs[next]?.focus()
                    tabs[next]?.click()
                  }}>
                  <span>{section.label}</span><span className="rl-section-count">{section.count}</span>
                </button>
              ))}
            </div>
            <div className="rl-facets">{facets}{overflow}</div>
          </header>
          <div className="lp-rows" role={sectionsAreTabs ? 'tabpanel' : 'region'} id={panelId}
            aria-labelledby={sectionsAreTabs ? tabId(activeSectionIndex) : undefined}
            aria-label={sectionsAreTabs ? undefined : title}>
            {rows.length === 0 && <div className="lp-empty">{emptyText}</div>}
            {rows.map((row) => row.href
              ? <a key={row.key} className={`lp-row ${row.cls || ''} ${cur === row.key ? 'cur' : ''}`} href={row.href}>{row.content}</a>
              : <div key={row.key} className={`lp-row inert ${row.cls || ''}`}>{row.content}</div>)}
          </div>
        </section>
      </div>
      {children}
    </PageScroll>
  )
}

// DetailShell is the standalone detail page's GitHub grammar. At phone width the same markup reflows to
// one column with side metadata first; failure and not-found remain distinct honest faces. `backHref` is
// the compact back anchor ([[address-routing]]'s detailBackHash supplies it) — a REAL <a href> derived
// from the canonical address, never a history.back button.
export function DetailShell({ title, titleMeta, status, side, composer, missing, failure, listHref, listLabel, backHref, backLabel, children }) {
  if (failure) {
    return (
      <PageScroll className="ds-page ds-missing ds-failed" role="alert">
        <div className="ds-missing-note">{failure}</div>
        {listHref && <a className="ds-backlink" href={listHref}>{listLabel}</a>}
      </PageScroll>
    )
  }
  if (missing) {
    return (
      <PageScroll className="ds-page ds-missing">
        <div className="ds-missing-note">{missing}</div>
        {listHref && <a className="ds-backlink" href={listHref}>{listLabel}</a>}
      </PageScroll>
    )
  }
  return (
    <PageScroll className="ds-page">
      <header className="ds-head">
        {backHref && (
          <a className="ds-back" href={backHref} data-tip={backLabel} aria-label={backLabel}>
            <Icon name="arrow-left" size={16} />
          </a>
        )}
        <h1 className="ds-title">
          {title}
          {titleMeta && <span className="ds-title-meta">{titleMeta}</span>}
        </h1>
      </header>
      {status && <div className="ds-status">{status}</div>}
      <div className="ds-cols">
        <div className="ds-main">
          {children}
          {composer && <div className="ds-compose">{composer}</div>}
        </div>
        <aside className="ds-side">{side}</aside>
      </div>
    </PageScroll>
  )
}

export function SideSection({ label, children }) {
  return (
    <div className="ds-side-sec">
      <span className="ds-side-label">{label}</span>
      <div className="ds-side-body">{children}</div>
    </div>
  )
}

// the ONE side-rail metadata VALUE ([[review-chrome]]): every rail row's value on BOTH detail pages
// renders through this primitive — a plain span, a REAL anchor (`href`), or a button (`onClick`) —
// sharing one markup shape and one truncation contract: the text container is min-width:0,
// single-line, shrinkable, ellipsizing when it exceeds the rail, with the full text kept reachable
// through the shared tooltip/accessible name (`tip` defaults to the text itself). `lead`/`trail`
// carry fixed-size adornments (a liveness dot, an icon) that never shrink. Pages supply data and an
// optional identity class — never a parallel inline span/anchor/tooltip variant of the same row.
export function SideValue({ text, tip, dim = false, mono = false, href = null, external = false, onClick = null, className = '', lead = null, trail = null, label = null }) {
  const cls = `ds-val${dim ? ' dim' : ''}${mono ? ' mono' : ''}${href || onClick ? ' link' : ''}${className ? ` ${className}` : ''}`
  const tipText = tip ?? (typeof text === 'string' ? text : undefined)
  // `label` names the ACTION on the interactive variants (a role-less span exposes no aria-label;
  // its accessible name is the full text already in the DOM — CSS truncation is visual only).
  const aria = label ? { 'aria-label': label } : {}
  const body = (
    <>
      {lead}
      <span className="ds-val-text">{text}</span>
      {trail}
    </>
  )
  if (href) {
    return (
      <a className={cls} href={href} data-tip={tipText} {...aria} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>{body}</a>
    )
  }
  if (onClick) {
    return <button type="button" className={cls} onClick={onClick} data-tip={tipText} {...aria}>{body}</button>
  }
  return <span className={cls} data-tip={tipText}>{body}</span>
}
