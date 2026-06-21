import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from './i18n/index.jsx'

// @@@ pane registry - add a face for a spec node by adding one entry + one render case below.
// The node popup is now PURELY a reference view (spec doc + version timeline); the live terminal
// moved out to the session interface (Enter), so there's no `work` pane and no keyboard special-case.
export const PANES = [
  { key: 'spec',    label: 'spec' },
  { key: 'history', label: 'history' },
  { key: 'issues',  label: 'issues' },
]

// @@@ panesFor - the edit tab exists ONLY when the node has a pending change (an overlay), and when it does
// it LEADS, so a node mid-change opens with its in-flight change front-and-center. Shared by NodeView's tab
// bar and App's keyboard pane-cycling so the two never disagree on order or on which tabs exist.
export function panesFor(node) {
  return node?.overlays?.length ? [{ key: 'edit', label: 'edit' }, ...PANES] : PANES
}

// op → glyph, kept local (a 4-entry map) so this popup never imports the graph node just for it.
const OP_GLYPH = { added: '+', edited: '~', deleted: '✕', moved: '→' }

// @@@ inline - the only inline markdown the spec bodies actually use: `code` (78×), **bold**,
// and [[links]]. Anything else passes through as text. Keeps us off a full markdown dependency.
function inline(text) {
  const out = []
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[\[([^\]]+)\]\]/g
  let last = 0, m, k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] != null) out.push(<code key={k++}>{m[1]}</code>)
    else if (m[2] != null) out.push(<strong key={k++}>{m[2]}</strong>)
    else out.push(<span className="doc-link" key={k++}>{m[3]}</span>)
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// @@@ SpecBody - render the spec.md body as a current-state document (markdown). It is NOT a
// changelog — version history is the recent/history tabs, sourced from git (spex lint's `living`
// rule keeps `## vN` headings out of the body). Fence-aware tokenizer: ``` code, # headings,
// `- ` lists, paragraphs. The leading `# title` line is dropped (it duplicates the panel header).
function SpecBody({ body }) {
  if (!body) return null
  const lines = body.replace(/^#\s+[^\n]*\n+/, '').split('\n')
  const out = []
  let i = 0, k = 0, inFence = false
  while (i < lines.length) {
    const t = lines[i].trim()
    if (/^```/.test(t)) {
      const buf = []; i++
      while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++])
      i++ // closing fence
      out.push(<pre className="doc-pre" key={k++}><code>{buf.join('\n')}</code></pre>)
    } else if (/^#{1,6}\s+/.test(lines[i])) {
      out.push(<h4 className="doc-h" key={k++}>{inline(lines[i].replace(/^#+\s+/, ''))}</h4>); i++
    } else if (/^-\s+/.test(t)) {
      const items = []
      while (i < lines.length && /^-\s+/.test(lines[i].trim())) items.push(lines[i++].trim().replace(/^-\s+/, ''))
      out.push(<ul key={k++}>{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>)
    } else if (t === '') {
      i++
    } else {
      const buf = []
      while (i < lines.length) {
        const l = lines[i]
        if (l.trim() === '' || /^```/.test(l.trim()) || /^#{1,6}\s+/.test(l) || /^-\s+/.test(l.trim())) break
        buf.push(l); i++
      }
      out.push(<p key={k++}>{inline(buf.join(' '))}</p>)
    }
  }
  return <div className="doc-body">{out}</div>
}

// @@@ TwoPart - render the body as the two labelled parts the backend parses (node.parts):
//   raw source (human, needs approval) · expanded spec (agent, must match raw). Each part is a card
//   with an owner badge so the reader sees WHO owns it and how stable it is. There is deliberately NO
//   agent-authored "current state" card — what's-done is DERIVED (the status/version/drift in the meta
//   line), never narrated, because agents hallucinate completion. Legacy bodies (parts === null) fall
//   back to the whole-body SpecBody in SpecPane.
function PartCard({ kind, title, owner, ownerLabel, note, children }) {
  return (
    <section className={`spec-part part-${kind}`}>
      <header className="part-head">
        <span className="part-title">{title}</span>
        <span className={`part-owner owner-${owner}`}>{ownerLabel}</span>
        {note && <span className="part-note">{note}</span>}
      </header>
      <div className="part-body">{children}</div>
    </section>
  )
}
function TwoPart({ parts }) {
  const t = useT()
  return (
    <div className="spec-parts">
      <PartCard kind="raw" title={t('nodeView.rawTitle')} owner="human" ownerLabel={t('nodeView.rawOwner')} note={t('nodeView.rawNote')}>
        <SpecBody body={parts.rawSource} />
      </PartCard>
      <PartCard kind="expanded" title={t('nodeView.expandedTitle')} owner="agent" ownerLabel={t('nodeView.expandedOwner')} note={t('nodeView.expandedNote')}>
        <SpecBody body={parts.expandedSpec} />
      </PartCard>
    </div>
  )
}

function SpecPane({ node }) {
  const t = useT()
  return (
    <div className="pane-doc">
      <h1># {node.title}</h1>
      <blockquote>{node.desc}</blockquote>
      <div className="doc-meta">
        {t('nodeView.statusLabel')} <b>{t(`status.${node.status}`)}</b> · {t('nodeView.versionLabel')} <b>v{node.version || 0}</b> · {t('nodeView.lastEditedBy')} <b>{node.session || t('common.none')}</b>
      </div>
      {node.code?.length > 0 && (
        <div className="doc-code">
          <span className="doc-code-h">{t('nodeView.governs')}</span>
          {node.code.map((f) => <code key={f} className="doc-code-f">{f}</code>)}
        </div>
      )}
      {node.parts ? <TwoPart parts={node.parts} /> : <SpecBody body={node.body} />}
    </div>
  )
}

// @@@ useHistory - the node's version log from git (/api/specs/:id/history), newest first. The single
// `history` tab below reads it: the latest version is expanded, older ones reveal as the reader scrolls.
function useHistory(id) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let on = true
    fetch(`/api/specs/${id}/history`).then((r) => r.json()).then((d) => { if (on) setRows(d) }).catch(() => on && setRows([]))
    return () => { on = false }
  }, [id])
  return rows
}

// @@@ useVersionDiff - one version's spec.md line-diff (/api/specs/:id/diff/:hash), fetched LAZILY the
// first time its history item expands. `enabled` keeps collapsed items from ever fetching; the latest
// item never uses this (the board already ships its diff as node.lastDiff, so it renders instantly).
function useVersionDiff(id, hash, enabled) {
  const [diff, setDiff] = useState(null)
  useEffect(() => {
    if (!enabled) return
    let on = true
    fetch(`/api/specs/${id}/diff/${hash}`).then((r) => r.json()).then((d) => { if (on) setDiff(d) }).catch(() => on && setDiff({ patch: '' }))
    return () => { on = false }
  }, [id, hash, enabled])
  return diff
}

// @@@ parseDiff - turn git's unified patch into renderable lines. Everything before the first `@@` is
// file-header metadata (diff/index/`new file mode`/--- /+++) — skip it wholesale rather than per-prefix,
// so an extended header line never gets mis-read as content and have its first char sliced off. In the
// hunk body, lines start with ` `/`+`/`-` (slice that marker off); `@@` opens each hunk; `\` is git's
// "No newline at end of file" note. Tag adds/dels so the view can colour them.
function parseDiff(patch) {
  const out = []
  let inBody = false
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) { inBody = true; out.push({ t: 'hunk', s: line }); continue }
    if (!inBody || line.startsWith('\\')) continue
    if (line.startsWith('+')) out.push({ t: 'add', s: line.slice(1) })
    else if (line.startsWith('-')) out.push({ t: 'del', s: line.slice(1) })
    else out.push({ t: 'ctx', s: line.slice(1) })
  }
  while (out.length && out[out.length - 1].t === 'ctx' && out[out.length - 1].s === '') out.pop()
  return out
}

// @@@ DiffEvidence - a version's proof-of-change: the actual line diff it introduced to spec.md. `diff ==
// null` = still loading (older items fetch lazily on expand); an empty patch = a version with no recorded
// spec.md change.
function DiffEvidence({ diff }) {
  const t = useT()
  if (diff == null) return <figcaption className="ev-note">{t('nodeView.loadingChange')}</figcaption>
  const lines = diff.patch ? parseDiff(diff.patch) : []
  if (!lines.length) return <figcaption className="ev-note">{t('nodeView.noChange')}</figcaption>
  return (
    <>
      <figcaption className="ev-difflabel">{t('nodeView.diffLabel')}</figcaption>
      <pre className="ev-diff">{lines.map((l, i) => <div key={i} className={`dl dl-${l.t}`}>{l.s || ' '}</div>)}</pre>
    </>
  )
}

// @@@ HistoryItem - one version in the merged history. Always its row header (number · hash · date · the
// +adds/−dels it changed in THIS node · reason · session), and — when expanded — its proof below: the
// spec.md line diff that version introduced. The latest item renders its diff instantly from node.lastDiff;
// older items fetch theirs lazily the first time they open. Clicking the header toggles the item by hand.
function HistoryItem({ node, r, v, latest, open, onToggle }) {
  const t = useT()
  const fetched = useVersionDiff(node.id, r.hash, open && !latest)
  const diff = latest ? (node.lastDiff ?? fetched) : fetched
  return (
    <div className={`ver-row${latest ? ' latest' : ''}${open ? ' open' : ''}`}>
      <button className="rec-toggle" onClick={onToggle} aria-expanded={open}>
        <div className="rec-head">
          <span className="rec-caret">{open ? '▾' : '▸'}</span>
          <span className="rec-v">v{v}</span>
          <code className="rec-hash">{r.hash.slice(0, 7)}</code>
          <span className="rec-date">{(r.date || '').slice(0, 10)}</span>
          <span className="rec-diff">
            <b className="rec-add">+{r.additions ?? 0}</b>
            <b className="rec-del">−{r.deletions ?? 0}</b>
          </span>
        </div>
        <div className="rec-msg">{r.reason}</div>
        <div className="rec-sub">{t('nodeView.filesChanged', { n: r.files ?? 0 })} · {r.session || t('common.idle')}</div>
      </button>
      {open && (
        <figure className="rec-evidence">
          <DiffEvidence diff={diff} />
        </figure>
      )}
    </div>
  )
}

// @@@ HistoryPane - the merged version log (the old `recent` + `history` tabs, now one). The latest
// version opens expanded with its proof; older ones start collapsed and REVEAL progressively as the
// reader scrolls — once the end of the deepest open item is in view (they've finished reading it), the
// next item expands. A header click toggles any item by hand. `rows` is NodeView's one fetch, newest-first.
function HistoryPane({ node, rows }) {
  const t = useT()
  const scRef = useRef(null)
  const [open, setOpen] = useState(() => new Set([0]))   // latest expanded; the rest reveal on scroll
  const toggle = useCallback((i) => setOpen((prev) => {
    const next = new Set(prev)
    if (next.has(i)) next.delete(i); else next.add(i)
    return next
  }), [])
  // @@@ revealNext - open the next still-collapsed version, but only once the reader has finished the
  // deepest open item (0..frontier) — its END must be within the viewport. ONE per call, so each down
  // gesture advances exactly one. getBoundingClientRect (not offsetTop) is correct regardless of the
  // scroller's own positioning. Shared by both triggers below.
  const revealNext = useCallback(() => setOpen((prev) => {
    const sc = scRef.current
    if (!sc) return prev
    let f = -1
    while (prev.has(f + 1)) f++
    if (f < 0 || f >= rows.length - 1) return prev
    const el = sc.querySelector(`[data-i="${f}"]`)
    if (!el || el.getBoundingClientRect().bottom - sc.getBoundingClientRect().top > sc.clientHeight + 40) return prev
    return new Set(prev).add(f + 1)
  }), [rows])
  // @@@ progressive reveal - the next version reveals on the DOWN gesture once you've read the open one.
  // TWO triggers, because a "scroll down" can't always happen: (1) the wheel/drag SCROLL event, while
  // there's overflow to move through; (2) a j/↓ KEYPRESS when the scroller can't move further — content
  // shorter than a page (no scrollbar at all) or already at the bottom. Without (2) those cases dead-ended:
  // no scroll event ever fired, so later versions never expanded. They never double-fire — (2) acts only
  // at the bottom, exactly where (1), which needs movement, cannot. (Mount and scroll-up never reveal.)
  useEffect(() => {
    const sc = scRef.current
    if (!sc || !rows?.length) return
    let prevTop = sc.scrollTop
    const onScroll = () => {
      const top = sc.scrollTop, down = top > prevTop
      prevTop = top
      if (down) revealNext()
    }
    const onKey = (e) => {
      if (e.key !== 'j' && e.key !== 'ArrowDown') return
      if (sc.scrollHeight - sc.clientHeight - sc.scrollTop > 1) return  // room to scroll → (1) handles it
      revealNext()
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('keydown', onKey, true)   // capture: App stopPropagation()s j/k but same-target listeners still run
    return () => { sc.removeEventListener('scroll', onScroll); window.removeEventListener('keydown', onKey, true) }
  }, [rows, revealNext])
  if (!rows) return <div className="pane-hist empty">{t('nodeView.loadingHistory')}</div>
  if (!rows.length) return <div className="pane-hist empty">{t('common.noVersions')}</div>
  return (
    <div className="pane-hist" ref={scRef}>
      {rows.map((r, i) => (
        <div data-i={i} key={r.hash}>
          <HistoryItem node={node} r={r} v={rows.length - i} latest={i === 0} open={open.has(i)} onToggle={() => toggle(i)} />
        </div>
      ))}
    </div>
  )
}

// @@@ IssuesPane - the node's bound forge work, OPEN and CLOSED both (the popover/badge on the board show
// only the open subset; this tab is the full ledger). The node arrives from the board already carrying
// `node.issues` (the [[dashboard-issues]] fold, open-first then newest); we just group it open/closed and
// render each as a card linking to the forge. Empty (or forge-less) → a plain "none yet" line, never a
// blank pane. No fetch here — one board poll already has the data, so the tab is instant like the rest.
function IssueRow({ i }) {
  return (
    <a className="issue-card" href={i.url} target="_blank" rel="noreferrer">
      <span className="issue-card-top">
        <span className="issue-num">#{i.number}</span>
        <span className={`issue-state st-${(i.state || '').toLowerCase()}`}>{i.state}</span>
      </span>
      <span className="issue-card-title">{i.title}</span>
    </a>
  )
}
function IssuesPane({ node }) {
  const t = useT()
  const issues = node.issues || []
  if (!issues.length) return <div className="pane-issues empty">{t('nodeView.noIssues')}</div>
  const open = issues.filter((i) => (i.state || '').toLowerCase() === 'open')
  const closed = issues.filter((i) => (i.state || '').toLowerCase() !== 'open')
  return (
    <div className="pane-issues">
      {open.length > 0 && (
        <>
          <div className="issue-group-head">{t('nodeView.openIssues', { n: open.length })}</div>
          {open.map((i) => <IssueRow key={i.number} i={i} />)}
        </>
      )}
      {closed.length > 0 && (
        <>
          <div className="issue-group-head closed">{t('nodeView.closedIssues', { n: closed.length })}</div>
          {closed.map((i) => <IssueRow key={i.number} i={i} />)}
        </>
      )}
    </div>
  )
}

// @@@ useEditDiff - the node's PENDING change content, fetched LAZILY when the edit tab opens (like the
// history tab's older diffs). The board's overlay markers say THAT a node changed, not WHAT — so this asks
// the backend (/api/edit) for the unified diff of the node's spec.md in the editing worktree (`source`) vs
// the fork point. `enabled` keeps a closed tab from ever fetching.
function useEditDiff(source, path, enabled) {
  const [diff, setDiff] = useState(null)
  useEffect(() => {
    if (!enabled || !source || !path) return
    let on = true
    fetch(`/api/edit?source=${encodeURIComponent(source)}&path=${encodeURIComponent(path)}`)
      .then((r) => r.json()).then((d) => { if (on) setDiff(d) }).catch(() => on && setDiff({ patch: '' }))
    return () => { on = false }
  }, [source, path, enabled])
  return diff
}

// @@@ EditPane - the node's in-flight change, made REVIEWABLE from the board. spec/history are near-empty for
// a node mid-change — a freshly-added ghost most of all (no committed version yet) — so this tab shows WHAT
// each live session is changing: the overlay's op + commit-state + author, and the unified diff of its
// spec.md vs the fork point, rendered with the SAME DiffEvidence the history tab uses. No overlay → a plain
// "no pending change" line. The overlay set (op markers) rides the board; only the diff content is fetched.
function EditOverlay({ node, ov }) {
  const t = useT()
  const diff = useEditDiff(ov.source, node.path, true)
  return (
    <figure className="edit-rev">
      <figcaption className="edit-by">
        <span className={`ov-mark ov-${ov.op}`}>{OP_GLYPH[ov.op] || '•'}</span>
        <span className="edit-by-label">{ov.label}</span>
        <span className="edit-state">{ov.committed ? t('nodeView.editCommitted') : t('nodeView.editDirty')}</span>
      </figcaption>
      <DiffEvidence diff={diff} />
    </figure>
  )
}
function EditPane({ node }) {
  const t = useT()
  const overlays = node.overlays || []
  if (!overlays.length) return <div className="pane-edit empty">{t('nodeView.noEdit')}</div>
  return <div className="pane-edit">{overlays.map((ov, i) => <EditOverlay key={i} node={node} ov={ov} />)}</div>
}

// PANES keys map to localized tab labels (the key drives logic; only the label is shown).
const PANE_LABEL = { spec: 'nodeView.paneSpec', history: 'nodeView.paneHistory', issues: 'nodeView.paneIssues', edit: 'nodeView.paneEdit' }

export default function NodeView({ node, pane, setPane, onClose }) {
  const t = useT()
  // one fetch per node, feeding the single history pane (the popup's only data dependency).
  const rows = useHistory(node.id)
  // @@@ tab counts - the issues tab carries its open/closed counts right on the tab face (green open ·
  // magenta closed, same vocabulary as the cards inside), so the bound-work tally reads at a glance
  // without opening the tab. Each badge shows only when non-zero; no issues → a bare `issues` label.
  const issuesAll = node.issues || []
  const issueOpen = issuesAll.filter((i) => (i.state || '').toLowerCase() === 'open').length
  const issueClosed = issuesAll.length - issueOpen
  // the edit tab carries the same kind of count: how many live sessions have a pending change to this node
  // (its overlays), so an in-flight change is visible on the tab face without opening it.
  const editCount = (node.overlays || []).length
  const panes = panesFor(node)
  // render the pane the user picked, but fall back to the first available if it isn't valid for THIS node
  // (e.g. 'edit' is selected, then a node with no overlay opens) — so a tab is always shown, never blank.
  const active = panes.some((p) => p.key === pane) ? pane : panes[0].key
  return (
    <div className="ov-backdrop" onMouseDown={onClose}>
      <div className="ov-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ov-head">
          <span className="ov-title">{node.title}</span>
          <div className="ov-tabs">
            {panes.map((p, i) => (
              <button key={p.key} className={p.key === active ? 'ov-tab on' : 'ov-tab'} onClick={() => setPane(p.key)}>
                <kbd>{i + 1}</kbd> {t(PANE_LABEL[p.key])}
                {p.key === 'issues' && (issueOpen > 0 || issueClosed > 0) && (
                  <span className="ov-tab-counts">
                    {issueOpen > 0 && <span className="ovc st-open" title={t('nodeView.openIssues', { n: issueOpen })}>{issueOpen}</span>}
                    {issueClosed > 0 && <span className="ovc st-closed" title={t('nodeView.closedIssues', { n: issueClosed })}>{issueClosed}</span>}
                  </span>
                )}
                {p.key === 'edit' && editCount > 0 && (
                  <span className="ov-tab-counts"><span className="ovc st-edit" title={t('nodeView.pendingEdits', { n: editCount })}>{editCount}</span></span>
                )}
              </button>
            ))}
          </div>
          <span className="ov-hint">{t('nodeView.hint')}</span>
        </div>
        <div className="ov-body">
          {active === 'spec' && <div className="pane-solo"><SpecPane node={node} /></div>}
          {active === 'history' && <HistoryPane node={node} rows={rows} />}
          {active === 'issues' && <IssuesPane node={node} />}
          {active === 'edit' && <EditPane node={node} />}
        </div>
      </div>
    </div>
  )
}
