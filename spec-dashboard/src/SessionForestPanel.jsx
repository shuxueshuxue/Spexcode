import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from './data.js'
import { Icon } from './icons.jsx'
import { SessionConsoleTreeRow, SessionZone } from './SessionWindow.jsx'
import { sessionAncestorIds, sessionForest } from './session.js'
import { expandSessionFolds, setSessionOfflineOpen, toggleSessionFold, useSessionListState } from './sessionListState.js'
import SessionSelectBar from './SessionSelectBar.jsx'
import { useT } from './i18n/index.jsx'
import { elementAt, startDrag } from './dragGesture.js'
import { isHoldGesture } from './tabs.js'

const GHOST_SCALE = 0.75

// The Sessions page owns the full mutable forest. The dock remains a compact finding projection; this panel
// is the product surface where row selection, bulk close, and parent movement have one coherent owner.
export default function SessionForestPanel({ sessions = [], activeId, onSelect, onSearch, reload, onContextMenu, onError, selectRequest = null, onSelectRequestConsumed }) {
  const t = useT()
  const { expanded, offlineOpen } = useSessionListState()
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState(() => new Set())
  const [drag, setDrag] = useState(null)
  const dragAbort = useRef(null)
  const listRef = useRef(null)

  const forest = useMemo(() => sessionForest(sessions, (id) => expanded.has(id), {
    zoneFolded: (zone) => zone === 'offline' && !offlineOpen,
    keepVisible: (session) => session.id === activeId,
  }), [sessions, expanded, offlineOpen, activeId])

  const changeParent = useCallback(async (childId, parent) => {
    const child = sessions.find((session) => session.id === childId)
    if (!child || (child.parent || null) === parent) return
    try {
      const response = await apiFetch('/api/sessions/reparent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ children: [childId], parent }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.ok === false) throw new Error(body?.error || `session parent update refused (HTTP ${response.status})`)
      if (parent) expandSessionFolds([parent])
      reload?.()
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error))
    }
  }, [sessions, reload, onError])

  const landingAt = useCallback((point, held) => {
    const row = elementAt(point.x, point.y, '[data-session-drop-id]')
    if (row) {
      const id = row.dataset.sessionDropId
      if (id === held.id || id === held.parent || sessionAncestorIds(sessions, id).includes(held.id)) return undefined
      return id
    }
    return held.parent && elementAt(point.x, point.y, '[data-session-root-drop]') ? null : undefined
  }, [sessions])

  const startRowDrag = useCallback((event, session) => {
    if (event.button !== 0 || selecting) return
    const source = event.currentTarget
    const bounds = source.getBoundingClientRect()
    const held = {
      id: session.id,
      parent: session.parent || null,
      width: bounds.width,
      height: bounds.height,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
      x: event.clientX,
      y: event.clientY,
      target: undefined,
      started: false,
    }
    const update = (point) => {
      held.x = point.x
      held.y = point.y
      held.target = landingAt(point, held)
      setDrag({ ...held })
    }
    const settle = () => {
      document.body.classList.remove('is-session-dragging')
      setDrag(null)
      dragAbort.current = null
    }
    dragAbort.current = startDrag(event, {
      onStart: (point) => {
        held.started = true
        document.body.classList.add('is-session-dragging')
        update(point)
      },
      onMove: update,
      onDrop: (point) => {
        const target = landingAt(point, held)
        settle()
        if (target !== undefined) void changeParent(held.id, target)
      },
      onCancel: settle,
    })
  }, [changeParent, landingAt, selecting])

  useEffect(() => () => dragAbort.current?.(), [])

  useEffect(() => {
    if (!selectRequest) return
    setSelecting(true)
    setPicked(new Set([selectRequest.id]))
    onSelectRequestConsumed?.()
  }, [selectRequest, onSelectRequestConsumed])

  const enterSelect = (session) => {
    setSelecting(true)
    setPicked(new Set([session.id]))
  }
  const exitSelect = () => {
    setSelecting(false)
    setPicked(new Set())
  }
  const togglePick = (id) => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const bulkClosed = () => {
    exitSelect()
    reload?.()
  }
  const draggedItem = drag ? forest.find((item) => item.type === 'row' && item.s.id === drag.id) : null
  const rootDrop = !!drag?.parent

  return (
    <aside className="si-list" ref={listRef}>
      {selecting ? (
        <SessionSelectBar ids={[...picked]} onCancel={exitSelect} onClosed={bulkClosed} onError={onError} />
      ) : (
        <div className="si-toprow">
          <button type="button" className={`si-pill new${activeId === 'new' ? ' on' : ''}`} aria-label={t('session.newSessionTitle')} onClick={() => onSelect?.('new')}>
            <span className="si-pill-glyph"><Icon name="plus" size={15} /></span>
          </button>
          <button type="button" className="si-pill search" aria-label={t('session.searchTitle')} onClick={onSearch}>
            <span className="si-pill-glyph"><Icon name="search" size={15} /></span>
          </button>
        </div>
      )}
      <div className="si-board-scroll" data-session-board-scroll>
        {rootDrop && <div className={`si-root-drop${drag.target === null ? ' on' : ''}`} data-session-root-drop data-tip={t('session.rootDrop')} aria-label={t('session.rootDrop')}>
          <Icon name="corner-up-left" size={14} />
          <span>{t('session.rootDrop')}</span>
        </div>}
        {forest.map((item) => {
          if (item.type === 'zone') {
            return <SessionZone key={`zone-${item.zone}`} item={item} baseClass="si-zone" onToggle={() => item.zone === 'offline' ? setSessionOfflineOpen(!offlineOpen) : undefined} />
          }
          const session = item.s
          const isPicked = selecting && picked.has(session.id)
          return <SessionConsoleTreeRow key={session.id} item={item} activeId={activeId} selecting={selecting} picked={picked}
            dragging={drag?.id === session.id} dropTarget={drag?.target === session.id} onToggleFold={() => toggleSessionFold(session.id)}
            rowProps={{
              'data-sid': session.id,
              'aria-grabbed': drag?.id === session.id || undefined,
              onMouseDown: (event) => startRowDrag(event, session),
              // The row owes [[tab-strip]] its two claimed gestures like every other surface that lists a
              // workspace object: a plain click reads the session in the current slot, ctrl/⌘ or a
              // double-click holds it as its own tab. Selection mode claims the click for picking instead,
              // so neither gesture fires while the reader is choosing rows.
              onClick: (event) => selecting ? togglePick(session.id) : onSelect?.(session.id, { hold: isHoldGesture(event) }),
              onDoubleClick: () => { if (!selecting) onSelect?.(session.id, { hold: true }) },
              onContextMenu: (event) => {
                event.preventDefault()
                event.stopPropagation()
                if (!selecting) onContextMenu?.({ x: event.clientX, y: event.clientY, session })
              },
              'data-tip': session.ops?.length ? t('session.opsTitle') : t('session.lockTitle'),
            }} />
        })}
      </div>
      {draggedItem && <SessionConsoleTreeRow item={draggedItem} activeId={activeId} selecting={selecting} picked={picked} inert
        style={{ width: drag.width, '--si-session-drag-ghost-scale': GHOST_SCALE, left: drag.x - drag.offsetX * GHOST_SCALE, top: drag.y - drag.offsetY * GHOST_SCALE }} />}
    </aside>
  )
}
