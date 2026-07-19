import { useEffect, useRef, useState } from 'react'

// The ONE shared review-page chrome ([[review-chrome]]): what BOTH GitHub-style page pairs render —
// #/evals and #/issues ([[evals-view]] / [[issues-view]]) — so the two surfaces can never drift into two
// near-identical dialects. Exactly two components live here: the LIST page skeleton and the DETAIL page
// skeleton. Pages contribute content (rows, filters, side metadata); layout, row rhythm, cursor keys, and
// the phone reflow live here once.

// ListPage — notice line, sticky head (CONTROL row over CHIP row), anchor rows, empty state. Rows arrive
// as data: { key, href, content, cls } — an href row renders as a REAL <a> (copy-link/middle-click work,
// a click is a normal hash PUSH); a row without one (a blind spot) is inert. j/k move a visual CURSOR
// (no detail pane exists to drive — Enter opens the cursor row's page); keys typed into inputs are never
// captured.
export function ListPage({ notice, controls, chips, rows, empty, children }) {
  const [cur, setCur] = useState(null)
  const stateRef = useRef({})
  stateRef.current = { rows, cur }
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'j' && e.key !== 'k' && e.key !== 'Enter') return
      const nav = stateRef.current.rows.filter((r) => r.href)
      if (!nav.length) return
      if (e.key === 'Enter') {
        const row = nav.find((r) => r.key === stateRef.current.cur)
        if (row) { e.preventDefault(); e.stopPropagation(); window.location.hash = row.href }
        return
      }
      e.preventDefault(); e.stopPropagation()
      const i = nav.findIndex((r) => r.key === stateRef.current.cur)
      const next = i < 0 ? (e.key === 'j' ? 0 : nav.length - 1) : Math.max(0, Math.min(nav.length - 1, i + (e.key === 'j' ? 1 : -1)))
      setCur(nav[next].key)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  useEffect(() => { document.querySelector('.lp-row.cur')?.scrollIntoView({ block: 'nearest' }) }, [cur])
  return (
    <div className="lp-page">
      {notice && <div className="fv-notice">{notice}</div>}
      <header className="lp-head">
        <span className="lp-controls">{controls}</span>
        {chips && <span className="ef-chipbar">{chips}</span>}
      </header>
      <div className="lp-rows">
        {rows.length === 0 && <div className="lp-empty">{empty}</div>}
        {rows.map((r) => r.href
          ? <a key={r.key} className={`lp-row ${r.cls || ''} ${cur === r.key ? 'cur' : ''}`} href={r.href}>{r.content}</a>
          : <div key={r.key} className={`lp-row inert ${r.cls || ''}`}>{r.content}</div>)}
      </div>
      {children}
    </div>
  )
}

// DetailShell — the standalone detail page's skeleton, GitHub's issue-page grammar measured live: header
// (title + trailing identity meta), a status band, then the MAIN column (content + an optional composer
// DOCKED STICKY at its foot) beside a fixed-width metadata SIDE rail. No fake back button — browser
// history is the return path. At phone width the same markup reflows to ONE column, side metadata FIRST
// (the 390px GitHub order) — pure CSS, never a second component. `missing` renders the honest not-found
// face with a link back to the list.
export function DetailShell({ title, titleMeta, status, side, composer, missing, listHref, listLabel, children }) {
  if (missing) {
    return (
      <div className="ds-page ds-missing">
        <div className="ds-missing-note">{missing}</div>
        {listHref && <a className="ds-backlink" href={listHref}>{listLabel}</a>}
      </div>
    )
  }
  return (
    <div className="ds-page">
      <header className="ds-head">
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
    </div>
  )
}

// one labelled block on the side rail — the shared metadata grammar (GitHub's sidebar sections).
export function SideSection({ label, children }) {
  return (
    <div className="ds-side-sec">
      <span className="ds-side-label">{label}</span>
      <div className="ds-side-body">{children}</div>
    </div>
  )
}
