import { useEffect, useId, useMemo, useRef } from 'react'
import { focusDiagram, scopeIds } from '@spexcode/archify/browser'
import '@spexcode/archify/diagram.css'
import { useT } from './i18n/index.jsx'
import { navigate } from './route.js'
import { useBoard } from './workspace.jsx'

// [[node-diagram]]: the node's diagram ([[diagram]]), drawn by the backend and painted here as plain inline SVG
// with archify's stylesheet — no viewer, no renderer in the bundle. A click focuses a box (its neighbours stay
// lit, its edges flow); a double-click on a box that is one of this node's children opens that child.
export default function NodeDiagram({ nodeId, diagram }) {
  const t = useT()
  const box = useRef(null)
  const instance = useId().replace(/[^\w-]/g, '')
  const { specs } = useBoard()
  const children = useMemo(() => new Set((specs || []).filter((s) => s.parent === nodeId).map((s) => s.id)), [specs, nodeId])
  // A popup and a background document can hold the same diagram at once; scoping the ids keeps each copy's
  // arrowheads its own.
  const svg = useMemo(() => (diagram?.svg ? scopeIds(diagram.svg, `d${instance}`) : null), [diagram?.svg, instance])

  useEffect(() => {
    const el = box.current?.querySelector('svg')
    if (!el) return undefined
    const idOf = (event) => event.target.closest?.('[data-node-id]')?.getAttribute('data-node-id') ?? null
    const onClick = (event) => focusDiagram(el, idOf(event))
    const onKeyDown = (event) => { if (event.key === 'Enter') focusDiagram(el, idOf(event)) }
    const onDoubleClick = (event) => {
      const id = idOf(event)
      if (id && children.has(id)) navigate('spec', id)
    }
    el.addEventListener('click', onClick)
    el.addEventListener('keydown', onKeyDown)
    el.addEventListener('dblclick', onDoubleClick)
    return () => {
      el.removeEventListener('click', onClick)
      el.removeEventListener('keydown', onKeyDown)
      el.removeEventListener('dblclick', onDoubleClick)
    }
  }, [svg, children])

  if (!diagram) return null
  if (diagram.error) {
    return (
      <div className="node-diagram node-diagram-failed" role="note">
        <span className="node-diagram-h">{t('nodeDiagram.failed', { file: diagram.file })}</span>
        <p className="node-diagram-error">{diagram.error}</p>
        {diagram.diagnostics.length > 0 && (
          <ul className="node-diagram-diagnostics">
            {diagram.diagnostics.map((d, i) => <li key={i}>{d.code && <code>{d.code}</code>} {d.message}</li>)}
          </ul>
        )}
      </div>
    )
  }
  return (
    <figure className="node-diagram">
      <div ref={box} className="archify" data-detail-level="read" dangerouslySetInnerHTML={{ __html: svg }} />
      {diagram.note && <figcaption className="node-diagram-note">{diagram.note}</figcaption>}
    </figure>
  )
}
