import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import EvalsGroup, { currentEntries, entryKey } from './EvalsFeed.jsx'
import EventDetail from './EventDetail.jsx'
import { postEvalOk } from './data.js'
import FoldToggle from './FoldToggle.jsx'
import { navigate, useRoute } from './route.js'
import { useT } from './i18n/index.jsx'

// The ONE eval master-detail SHELL ([[evals-view]]): the split, the fold, the j/k walk, and the detail
// slot — shared by BOTH eval master-detail homes (the Evals page below, and the session console's Eval
// tab, [[session-eval]]'s SessionEval), so the two surfaces cannot drift apart on geometry or keys.
// Controlled: the parent owns the selection (`sel` already fallback-resolved) and the visible key list;
// the shell owns only what is purely shell — fold state, the j/k binding (capture; a key typed into an
// input or carrying a modifier is never ours), and keeping the selected row scrolled into view.
export function EvalMasterDetail({ rowKeys, sel, onSel, detail, children }) {
  const [folded, setFolded] = useState(false)   // the master list folded to a strip — the detail owns the width
  const stateRef = useRef({})
  stateRef.current = { rowKeys, sel }
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'j' && e.key !== 'k') return
      e.preventDefault(); e.stopPropagation()
      const { rowKeys: rows, sel: cur } = stateRef.current
      if (!rows.length) return
      const i = rows.indexOf(cur)
      const next = i < 0 ? (e.key === 'j' ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, i + (e.key === 'j' ? 1 : -1)))
      onSel(rows[next])
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onSel])
  useEffect(() => {
    document.querySelector('.fv-list-col .sel')?.scrollIntoView({ block: 'nearest' })
  }, [sel])
  // the fold toggle is an ANCHORED control, not a floating badge: the shell owns the fold state, but the
  // button renders inside the list's own head row (function children receive it as `foldBtn`), a normal
  // flex sibling of the filters — never absolutely positioned over the list's scrollbar. A plain-children
  // home (the session Eval tab's multi-group list, which has no single head row) keeps the floating badge.
  const foldBtn = <FoldToggle className="fv-fold-inline" onToggle={() => setFolded(true)} />
  return (
    <div className={`fv-master ${folded ? 'folded' : ''}`}>
      {/* the list column stays MOUNTED while folded (its filter state + the j/k row report live in it) —
          the fold is pure CSS; the thin strip is the unfold affordance. */}
      {folded && <FoldToggle className="fv-unfold" folded onToggle={() => setFolded(false)} />}
      <div className="fv-list-col" style={folded ? { display: 'none' } : undefined}>
        {typeof children === 'function'
          ? children(foldBtn)
          : <><FoldToggle className="fv-fold" onToggle={() => setFolded(true)} />{children}</>}
      </div>
      <div className="fv-detail">{detail}</div>
    </div>
  )
}

// The Evals page ([[evals-view]]): a top-level page (#/evals, [[side-nav]]), peer of the graph, the
// session board, and the Issues page — the project's CURRENT measured loss, leading the surfaces (the
// board's `f` and ⌥F land here). MASTER-DETAIL over one full routed page: the LEFT column is the SLIM
// [[evals-feed]] list (latest reading per scenario, fresh first, video first — its own filter chips),
// the RIGHT pane the full-height [[event-detail]] of the selection. Selection IS the detail (no Enter,
// no in-place expansion), and the selection HAS an address: `#/evals/<node>/<scenario>` is the canonical
// eval URL — a deep link selects that eval (widening the feed's default kind filter if it would hide it),
// and every selection echoes back into the hash with replace (tabs replace, pages push — [[side-nav]]),
// so the shown eval is always shareable. A remark write refreshes the board (the eval thread rides the
// board overlay, not the issues list).
export default function EvalsPage({ specs = [], sessions = [], reloadBoard, onOpenSession }) {
  const t = useT()
  const { page, param } = useRoute()
  const [sel, setSel] = useState(null)            // the ONE selection: 'eval:<node>·<scenario>'
  const [notice, setNotice] = useState('')
  const [evalRows, setEvalRows] = useState([])    // the feed's visible entries (its filters are its own)
  const rowsRef = useRef([])                      // the visible eval key list, for j/k
  const evalByKey = useMemo(() => new Map(evalRows.map((e) => [entryKey(e), e])), [evalRows])
  rowsRef.current = evalRows.map(entryKey)
  // default selection: the feed's first row — the detail pane is never idle by default.
  const effSel = sel && evalByKey.has(sel) ? sel : rowsRef.current[0] ?? null

  // deep link → selection: '#/evals/<node>/<scenario>' applies its address to the selection (the
  // sessions-page param sync's twin). The target may be hidden by the feed's default kind filter —
  // `mustShow` hands it to the feed, which widens its own filter (the filter stays the feed's state).
  const urlSel = useMemo(() => {
    if (!param) return null
    const i = param.indexOf('/')
    return i > 0 ? `eval:${param.slice(0, i)}·${param.slice(i + 1)}` : null
  }, [param])
  // the widen handshake is ONE-SHOT per arrival: `deepWant` carries the address to the feed's mustShow
  // only until the entry is visible, then clears. A later chip click that hides the selection is a filter
  // decision the human just made — never a reason to snap the filter back ([[evals-feed]]: the chips are
  // the group's own state; the page widens only for a deep-link ARRIVAL). The hidden selection instead
  // falls to the first visible row (below), and the URL re-canonicalizes to it.
  const [deepWant, setDeepWant] = useState(null)
  useEffect(() => { if (page === 'evals' && urlSel) { setSel(urlSel); setDeepWant(urlSel) } }, [page, urlSel])
  useEffect(() => { if (deepWant && evalByKey.has(deepWant)) setDeepWant(null) }, [deepWant, evalByKey])
  // selection → URL echo with replace (no history entry per row-hop). While a deep-linked selection is
  // still pending (its row not yet in the visible list), hold the echo — never canonicalize AWAY from an
  // address the user just arrived on before the feed has had the chance to show it. An address naming an
  // eval that does not EXIST (checked against the same latest-per-scenario computation the feed renders)
  // is dropped instead: the page falls back to the first row and the URL canonicalizes to it.
  const pending = sel && !evalByKey.has(sel)
  const selExists = useMemo(
    () => !pending || currentEntries(specs).some((e) => entryKey(e) === sel),
    [pending, specs, sel],
  )
  useEffect(() => { if (pending && !selExists) { setSel(null); setDeepWant(null) } }, [pending, selExists])
  // a selection hidden by the human's OWN filtering (no deep-link in flight): drop it so effSel + the echo
  // re-anchor on the first visible row instead of freezing the URL on a hidden entry.
  useEffect(() => {
    if (sel && !deepWant && evalRows.length && !evalByKey.has(sel)) setSel(null)
  }, [sel, deepWant, evalRows, evalByKey])
  useEffect(() => {
    if (page !== 'evals' || !effSel || pending) return
    const m = /^eval:([^·]+)·(.+)$/.exec(effSel)
    if (m) navigate('evals', `${m[1]}/${m[2]}`, { replace: true })
  }, [page, effSel, pending])

  const onRows = useCallback((rows) => setEvalRows(rows), [])

  // a remark's dispatch echo ([[mentions]], mirrors [[issues-view]]): the write's outcomes summary
  // ('@ new→<session>') flashes as a notice, so an @-dispatch is never silent.
  const flash = (outcomes) => { if (outcomes) { setNotice(outcomes); setTimeout(() => setNotice(''), 6000) } }

  // the feed row's human sign-off ([[human-ok]]) — the same server write the detail header and `spex eval
  // ok` use; a refused write surfaces its server message, success just reloads (the ok'd row leaves the
  // default feed by the feed's own hide).
  const okEval = useCallback(async (e) => {
    const r = await postEvalOk(e.node, e.scenario).catch((err) => ({ error: String(err) }))
    flash(r?.error || '')
    await reloadBoard?.()
  }, [reloadBoard])

  const selEval = effSel ? evalByKey.get(effSel) : null

  return (
    <EvalMasterDetail
      rowKeys={rowsRef.current}
      sel={effSel}
      onSel={setSel}
      detail={selEval
        ? <EventDetail entry={selEval} specs={specs} sessions={sessions} onOpenSession={onOpenSession} onWrite={async (outcomes) => { flash(outcomes); await reloadBoard?.() }} />
        : <div className="fv-note">{t('evalsFeed.empty')}</div>}
    >
      {(foldBtn) => (
        <>
          {notice && <div className="fv-notice">{notice}</div>}
          <EvalsGroup nodes={specs} sessions={sessions} sel={effSel} onSel={(k) => setSel(k)} onRows={onRows} onOk={okEval} mustShow={deepWant} lead={foldBtn} />
        </>
      )}
    </EvalMasterDetail>
  )
}
