import { useEffect, useMemo, useRef, useState } from 'react'
import { STATUS } from './specMeta.js'
import { STATUS_COLOR, sessionHandle, sessionHeadline, sessionPresentationOrder } from './session.js'
import { useT } from './i18n/index.jsx'
import { rankDocs } from '@spexcode/spec-cli/ranker'
import { useSpecCorpus } from './corpus.js'
import { sessionAddress, specAddress } from './address.js'
import { isNewTabGesture } from './tabs.js'
// the breadcrumb path the rows show + match against — the same path the @-mention rows read
import { specPath } from './mentions.jsx'

// TWO PLANES — the things a workspace HOLDS. A node and a session are what a tab can be, so every row here
// is somewhere the reader can go and stay; that is what makes this a jump-list rather than a report.
//
// The palette used to carry two more (issues, scenarios) plus two "all results" doors into the review
// lists, and that was a search box quietly growing a second job. An issue and a scenario are findings ABOUT
// a node — they have real list pages built to filter and page them ([[issues-view]] / [[evals-view]]), and
// those pages are one ⌥digit away. Restating a page-1 slice of them under the jump-list gave the reader a
// worse version of a surface that already exists, and cost two server round-trips on every keystroke to do
// it. Deleting the planes deletes the round-trips with them.
//
// `boost` lifts ONE plane to the front — the SAME palette leads with whatever surface opened it. It is the
// ONLY knob a caller turns: matcher, interleave, and keys are identical; only the lead order differs.
const BASE_PLANES = ['spec', 'session']
const planeOrder = (boost) => (boost ? [boost, ...BASE_PLANES.filter((p) => p !== boost)] : BASE_PLANES)

// fold both planes into one flat list of uniform entries; each carries the row's display fields, the
// `target` App acts on, and the scorer's name/desc/body fields mapped per plane.
export function buildEntries(specs, sessions, corpus) {
  const bodies = corpus?.bodies
  const entries = []
  for (const s of specs) {
    const path = specPath(s.path)
    entries.push({
      kind: 'spec', key: `spec:${s.id}`, target: s.id,
      address: specAddress(s.id),
      color: (STATUS[s.status] || STATUS.pending).color,
      title: s.title || s.id, sub: path,
      // the shared ranker's three fields, the SAME map the floor uses for a node: name = title+id, desc = the
      // one-line summary, body = the spec prose. So the palette ranks a node by the maths `spex search` runs —
      // prose reached via BM25, not the old whole-query substring. (Path is shown in `sub` but, like the floor,
      // no longer a search field — its segments are the node names/prose already in name+body.)
      // body is no longer on the board ([[graph-lean]]) — it comes from the lazily-fetched corpus (`bodies`),
      // falling back to any body still on the node (a fixture, or before the corpus lands).
      name: `${s.title || s.id} ${s.id}`, desc: s.desc || '', body: bodies?.[s.id] ?? s.body ?? '',
    })
  }
  for (const s of sessionPresentationOrder(sessions)) {
    // a session reads as ONE name everywhere: the shared sessionHeadline ([[session-activity]]) the board rows,
    // window, tabs, and console header all show — NOT the raw stable handle, which left the palette naming a
    // session differently from the board it was searched from. The handle rides in `body` as the match text;
    // on a current backend it IS the server-derived label (rename name / prompt truncation), and that label
    // is the whole search promise — raw id/node/branch fragments are deliberately not promised to match.
    const headline = sessionHeadline(s)
    const handle = sessionHandle(s)
    const sub = s.status || s.promptPreview || s.note || ''
    entries.push({
      kind: 'session', key: `session:${s.id}`, target: s.id,
      address: sessionAddress(s.id),
      color: STATUS_COLOR[s.status] || STATUS_COLOR.offline,
      title: headline, sub,
      name: headline || '', desc: s.status || '', body: `${s.promptPreview || s.note || ''} ${handle}`.trim(),
    })
  }
  return entries
}

// rank entries via the SHARED scorer (spec-cli/src/ranker.ts) — the same maths `spex search` runs server-side,
// so the palette no longer ranks node prose more crudely than the agent. An empty query is the plain
// jump-list: planes group in caller-selected order and each plane keeps its source surface's stable order.
//
// Cross-plane: rank each plane on its own, then INTERLEAVE them (a node, a session, a node, a session).
// NOT one rankDocs over both — nodes carry far richer text than sparse sessions, so a single relevance list
// buries the session plane (a node-heavy query like "session" returns only nodes, verified in-browser).
// (The floor has only nodes, so it needs none of this cross-plane work.)
function rank(entries, query, planes) {
  const order = Object.fromEntries(planes.map((k, i) => [k, i]))
  const jump = (a, b) => order[a.kind] - order[b.kind]
  if (!query.trim()) return entries.slice().sort(jump).slice(0, 15)
  const ranked = {}
  for (const k of planes) {
    const docs = entries.filter((e) => e.kind === k)
    ranked[k] = rankDocs(query, docs.sort((a, b) => a.name.length - b.name.length || a.key.localeCompare(b.key))
      .map((e) => ({ ref: e, name: e.name, desc: e.desc, body: e.body })), { limit: 15 }).map((r) => r.ref)
  }
  const out = []
  for (let i = 0; out.length < 15; i++) {
    let added = false
    for (const k of planes) if (ranked[k][i] && out.length < 15) { out.push(ranked[k][i]); added = true }
    if (!added) break
  }
  return out
}

export default function SpecSearch({ specs, sessions, onPick, onClose, boost = null }) {
  const t = useT()
  // Node prose stays in the lite corpus, never on the graph rows. The palette makes no server request of
  // its own now — both planes are already in the board the shell handed it.
  const corpus = useSpecCorpus()
  const [q, setQ] = useState('')
  // the RANKED query trails the typed one by a short debounce: rank() runs BM25 once per plane, so ranking
  // on every keystroke of a fast typist burns one rankDocs per plane per keypress for results the next key discards.
  // 120ms is under the perceive-as-instant line; an emptied query resets immediately (the jump-list is cheap).
  const [dq, setDq] = useState('')
  useEffect(() => {
    if (!q.trim()) { setDq(q); return }
    const id = setTimeout(() => setDq(q), 120)
    return () => clearTimeout(id)
  }, [q])
  const [sel, setSel] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const planes = useMemo(() => planeOrder(boost), [boost])
  const entries = useMemo(() => buildEntries(specs, sessions, corpus), [specs, sessions, corpus])
  const results = useMemo(() => rank(entries, dq, planes), [entries, dq, planes])

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setSel(0) }, [q])  // a fresh query always re-aims the highlight at the top result
  // keep the highlighted row in view as ↑/↓ walk past the visible window.
  useEffect(() => { listRef.current?.querySelector('.search-item.on')?.scrollIntoView({ block: 'nearest' }) }, [sel, results])

  // hand the whole entry back; App executes the entry's app address (a graph node, or a session). A HOLD
  // rides along as the caller's second argument rather than as a second door: the palette knows the
  // gesture, the shell knows what to do with an address, and [[tab-strip]] owns what a new tab means.
  const pick = (e, newTab = false) => { if (e) { onPick(e, { newTab }); onClose() } }

  // the input OWNS its keys (App returns early while search is open — see onKey there), so ↑/↓ walk the
  // result list, Enter jumps to the highlighted entry, Esc closes; everything else types into the query.
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(results.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(0, i - 1)) }
    // ⌘/ctrl+Enter is the pointer new-tab gesture's keyboard twin — the palette is where a reader arrives WITHOUT a
    // pointer, so the gesture has to exist for the hand that got here by typing.
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[sel], e.ctrlKey || e.metaKey) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  return (
    <div className="search-backdrop" data-focus-overlay onClick={onClose}>
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
          {results.map((e, i) => (
            <li
              key={e.key}
              className={`search-item${i === sel ? ' on' : ''}`}
              data-kind={e.kind}
              data-target={e.target}
              onMouseEnter={() => setSel(i)}
              onClick={(event) => pick(e, isNewTabGesture(event))}
            >
              <span className="node-dot" style={{ background: e.color }} />
              <span className={`search-kind k-${e.kind}`}>{t(`search.kind.${e.kind}`)}</span>
              <span className="search-title">{e.title || e.target}</span>
              <span className="search-path">{e.sub}</span>
            </li>
          ))}
        </ul>
        <div className="search-foot">{t('search.hint')}</div>
      </div>
    </div>
  )
}
