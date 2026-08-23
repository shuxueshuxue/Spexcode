import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar } from './avatar.jsx'
import { sessionDisplayState, sessionHandle, sessionHeadline } from './session.js'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'

function labelFor(session) {
  return sessionHeadline(session) || session?.id?.slice(0, 8) || ''
}

export function SessionPickerRow({ session, active = false, selected = false, onPick, onHover, onOpen, compact = false, newSession = false, name = null, className = '' }) {
  const t = useT()
  const display = newSession ? null : sessionDisplayState(session)
  const label = newSession ? t('sessionPicker.newSession') : labelFor(session)
  const title = newSession ? label : `${label} · ${t(`status.${display.status}`)}`
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`session-picker-row${active ? ' active' : ''}${selected ? ' selected' : ''}${compact ? ' compact' : ''}${newSession ? ' new' : ''}${className ? ` ${className}` : ''}`}
      data-session-picker-id={newSession ? 'new' : session.id}
      title={title}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      onDoubleClick={() => onOpen?.(newSession ? 'new' : session.id)}
      onClick={() => onPick?.(newSession ? 'new' : session.id)}
    >
      {newSession
        ? <span className="session-picker-new-icon" aria-hidden="true"><Icon name="plus" size={13} /></span>
        : <Avatar seed={session.id} status={display.status} size={compact ? 15 : 17} title={title} />}
      <span className="session-picker-name">{name || label}</span>
      {!newSession && <span className="session-picker-status" style={{ color: display.color }} aria-label={t(`status.${display.status}`)}>{display.glyph}</span>}
    </button>
  )
}

export default function SessionPicker({ sessions = [], value = '', onChange, onOpen, includeNew = false, filter = true, placeholder, ariaLabel, className = '', compact = false, autoFocus = false }) {
  const t = useT()
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const choices = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const rows = sessions.filter((session) => !needle || [labelFor(session), sessionHandle(session), session.id].some((text) => text?.toLocaleLowerCase().includes(needle)))
    return includeNew ? [...rows, { id: 'new', __new: true }] : rows
  }, [includeNew, query, sessions])
  useEffect(() => { setActive((index) => Math.min(index, Math.max(choices.length - 1, 0))) }, [choices.length])
  useEffect(() => { if (autoFocus) inputRef.current?.focus() }, [autoFocus])
  const pick = (id) => { onChange?.(id); if (id !== 'new') setQuery('') }
  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => choices.length ? (index + 1) % choices.length : 0) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => choices.length ? (index - 1 + choices.length) % choices.length : 0) }
    else if (event.key === 'Enter') { event.preventDefault(); const choice = choices[active]; if (choice) pick(choice.id) }
  }
  return (
    <div className={`session-picker${compact ? ' compact' : ''}${className ? ` ${className}` : ''}`}>
      {filter && <input ref={inputRef} className="session-picker-filter" value={query} placeholder={placeholder || t('sessionPicker.filter')} aria-label={ariaLabel || t('sessionPicker.filter')} onChange={(event) => { setQuery(event.target.value); setActive(0) }} onKeyDown={onKeyDown} />}
      <div className="session-picker-list" role="listbox" aria-label={ariaLabel || t('sessionPicker.label')}>
        {choices.length ? choices.map((choice, index) => choice.__new
          ? <SessionPickerRow key="new" newSession active={index === active} selected={value === 'new'} onPick={pick} onOpen={onOpen} onHover={() => setActive(index)} compact={compact} />
          : <SessionPickerRow key={choice.id} session={choice} active={index === active} selected={value === choice.id} onPick={pick} onOpen={onOpen} onHover={() => setActive(index)} compact={compact} />)
          : <div className="session-picker-empty">{t('sessionPicker.empty')}</div>}
      </div>
    </div>
  )
}
