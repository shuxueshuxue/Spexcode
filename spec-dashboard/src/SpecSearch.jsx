import { useEffect, useMemo, useRef, useState } from 'react'
import { STATUS } from './SpecNode.jsx'
import { useT } from './i18n/index.jsx'

// @@@ SpecSearch - the Alt+F jump-to-node palette. The board is a DRILL-DOWN (expand-on-focus), so a
// node buried in a collapsed subtree is otherwise reachable only by walking its whole ancestor spine.
// This searches the WHOLE raw tree (not just the visible/expanded nodes) and, on pick, just focuses the
// id — App's expand-on-focus then re-plots the spine open and the camera pans to it. No new navigation
// concept: it's a shortcut into the same focus state the arrows drive, for nodes you can't yet see.

// the breadcrumb path the rows show + match against (`.spec/a/b/<id>/spec.md` minus the shell + leaf),
// so a row reads like the tree path it is. Mirrors SessionInterface's @-mention path.
const specPath = (p) => (p || '').replace(/^\.spec\//, '').replace(/\/spec\.md$/, '')

// rank nodes for the query: a hit in the human TITLE outranks the id, which outranks the breadcrumb
// path; a prefix beats a mid-string hit within each. Empty query lists the whole tree (Alt+F with no
// typing is a plain jump-list). Shorter ids break ties so the most specific node floats up.
function rank(specs, query) {
  const q = query.trim().toLowerCase()
  const scored = []
  for (const s of specs) {
    const title = (s.title || '').toLowerCase()
    const id = s.id.toLowerCase()
    const path = specPath(s.path).toLowerCase()
    let score
    if (!q) score = 5
    else if (title.startsWith(q)) score = 0
    else if (id.startsWith(q)) score = 1
    else if (title.includes(q)) score = 2
    else if (id.includes(q)) score = 3
    else if (path.includes(q)) score = 4
    else continue
    scored.push({ s, score })
  }
  scored.sort((a, b) => a.score - b.score || a.s.id.length - b.s.id.length || a.s.id.localeCompare(b.s.id))
  return scored.slice(0, 12).map((x) => x.s)
}

export default function SpecSearch({ specs, onPick, onClose }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const results = useMemo(() => rank(specs, q), [specs, q])

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setSel(0) }, [q])  // a fresh query always re-aims the highlight at the top result
  // keep the highlighted row in view as ↑/↓ walk past the visible window.
  useEffect(() => { listRef.current?.querySelector('.search-item.on')?.scrollIntoView({ block: 'nearest' }) }, [sel, results])

  const pick = (n) => { if (n) { onPick(n.id); onClose() } }

  // the input OWNS its keys (App returns early while search is open — see onKey there), so ↑/↓ walk the
  // result list, Enter jumps to the highlighted node, Esc closes; everything else types into the query.
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(results.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[sel]) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  return (
    <div className="search-backdrop" onClick={onClose}>
      <div className="search-panel" role="dialog" aria-modal="true" aria-label={t('search.title')} onClick={(e) => e.stopPropagation()}>
        <div className="search-bar">
          <span className="search-icon">⌕</span>
          <input
            ref={inputRef}
            className="search-input"
            value={q}
            placeholder={t('search.placeholder')}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <ul className="search-results" ref={listRef}>
          {results.length === 0 && <li className="search-empty">{t('search.empty')}</li>}
          {results.map((n, i) => {
            const st = STATUS[n.status] || STATUS.pending
            return (
              <li
                key={n.id}
                className={`search-item${i === sel ? ' on' : ''}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => pick(n)}
              >
                <span className="node-dot" style={{ background: st.color }} />
                <span className="search-title">{n.title || n.id}</span>
                <span className="search-path">{specPath(n.path)}</span>
              </li>
            )
          })}
        </ul>
        <div className="search-foot">{t('search.hint')}</div>
      </div>
    </div>
  )
}
