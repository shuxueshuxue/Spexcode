import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import EvalsGroup, { entryKey } from './EvalsFeed.jsx'
import EventDetail from './EventDetail.jsx'
import { useT } from './i18n/index.jsx'

// The Evals page ([[evals-view]]): a top-level page (#/evals, [[side-nav]]), peer of the graph, the
// session board, and the Issues page — the project's CURRENT measured loss, leading the surfaces (the
// board's `f` and ⌥F land here). MASTER-DETAIL over one full routed page: the LEFT column is the SLIM
// [[evals-feed]] list (latest reading per scenario, fresh first, video first — its own filter chips),
// the RIGHT pane the full-height [[event-detail]] of the selection. The list column is title-only, so it
// stays narrow, and a fold toggle collapses it to a thin strip — once a human is working one eval, the
// detail workspace owns the width. Selection IS the detail (no Enter, no in-place expansion): picking an
// eval row renders it in EventDetail — the media stage, the A/B strip, the remark rail. j/k walk the feed
// even while folded, the detail follows. A remark write refreshes the board (the eval thread rides the
// board overlay, not the issues list).
export default function EvalsPage({ specs = [], sessions = [], reloadBoard }) {
  const t = useT()
  const [sel, setSel] = useState(null)            // the ONE selection: 'eval:<node>·<scenario>'
  const [folded, setFolded] = useState(false)     // the master list folded to a strip — the detail owns the width
  const [evalRows, setEvalRows] = useState([])    // the feed's visible entries (its filters are its own)
  const rowsRef = useRef([])                      // the visible eval key list, for j/k

  const evalByKey = useMemo(() => new Map(evalRows.map((e) => [entryKey(e), e])), [evalRows])
  rowsRef.current = evalRows.map(entryKey)
  // default selection: the feed's first row — the detail pane is never idle by default.
  const effSel = sel && evalByKey.has(sel) ? sel : rowsRef.current[0] ?? null

  const onRows = useCallback((rows) => setEvalRows(rows), [])

  // page keys ([[evals-view]]): j/k walk the feed; the detail follows the selection (no Enter — selection
  // IS detail). Capture phase; a key typed into an input/textarea or carrying a modifier is never ours.
  const stateRef = useRef({})
  stateRef.current = { effSel }
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'j' && e.key !== 'k') return
      e.preventDefault(); e.stopPropagation()
      const rows = rowsRef.current
      if (!rows.length) return
      const cur = rows.indexOf(stateRef.current.effSel)
      const next = cur < 0 ? (e.key === 'j' ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, cur + (e.key === 'j' ? 1 : -1)))
      setSel(rows[next])
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  useEffect(() => {
    document.querySelector('.fv-list-col .sel')?.scrollIntoView({ block: 'nearest' })
  }, [effSel])

  const selEval = effSel ? evalByKey.get(effSel) : null

  return (
    <div className={`fv-master ${folded ? 'folded' : ''}`}>
      {/* the list column stays MOUNTED while folded (its filter state + the j/k row report live in it) —
          the fold is pure CSS; the thin strip is the unfold affordance. */}
      {folded && <button type="button" className="fv-unfold" title={t('masterList.unfold')} onClick={() => setFolded(false)}>›</button>}
      <div className="fv-list-col" style={folded ? { display: 'none' } : undefined}>
        <button type="button" className="fv-fold" title={t('masterList.fold')} onClick={() => setFolded(true)}>‹</button>
        <EvalsGroup nodes={specs} sel={effSel} onSel={(k) => setSel(k)} onRows={onRows} />
      </div>
      <div className="fv-detail">
        {selEval
          ? <EventDetail entry={selEval} specs={specs} sessions={sessions} onWrite={async () => { await reloadBoard?.() }} />
          : <div className="fv-note">{t('evalsFeed.empty')}</div>}
      </div>
    </div>
  )
}
