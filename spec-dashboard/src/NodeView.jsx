import { useCallback, useEffect, useRef, useState } from 'react'
import { ScoreBadge, readingScore } from './score.jsx'
import { useT } from './i18n/index.jsx'

// @@@ pane registry - add a face for a spec node by adding one entry + one render case below.
// The node popup is now PURELY a reference view (spec doc + version timeline); the live terminal
// moved out to the session interface (Enter), so there's no `work` pane and no keyboard special-case.
export const PANES = [
  { key: 'spec',    label: 'spec' },
  { key: 'history', label: 'history' },
  { key: 'issues',  label: 'issues' },
  { key: 'eval',    label: 'eval' },
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

export function SpecPane({ node }) {
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
export function useHistory(id) {
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
// item never uses this (the board already ships its diff as node.lastDiff, so it renders instantly). A
// commit hash's diff is immutable, so results are memoised per (id,hash): collapsing then re-expanding an
// older version — its evidence figure unmounts on collapse — reads the cache instead of refetching/flashing.
const versionDiffCache = new Map()
function useVersionDiff(id, hash, enabled) {
  const key = `${id}/${hash}`
  const [diff, setDiff] = useState(() => versionDiffCache.get(key) ?? null)
  useEffect(() => {
    if (!enabled) return
    const cached = versionDiffCache.get(key)
    if (cached) { setDiff(cached); return }
    let on = true
    fetch(`/api/specs/${id}/diff/${hash}`).then((r) => r.json())
      .then((d) => { versionDiffCache.set(key, d); if (on) setDiff(d) })
      .catch(() => on && setDiff({ patch: '' }))
    return () => { on = false }
  }, [id, hash, enabled, key])
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

// @@@ ChronoPane - the shared chronological-timeline scaffold behind BOTH the history and eval tabs. It owns
// the one scroll container, the open-set (item 0 — the latest — starts expanded, the rest REVEAL one at a time
// on the down gesture, see revealNext), the manual click-toggle, and the per-item shape: a toggle-header button
// over an evidence <figure> that unfolds when open. It is DATA-AGNOSTIC — it knows nothing of versions or
// readings: each consumer supplies the items, their React key, the scaffold class names (so history and eval
// keep their own CSS), an optional per-row modifier class, and two render props for the header and the
// evidence. Empty/loading states live in the consumers (each has its own vocabulary), so `items` is always a
// non-empty array here. revealNext + its two triggers are the progressive reveal, lifted from the old
// HistoryPane verbatim, so the history tab is unchanged and the eval tab inherits the same gesture.
function ChronoPane({ items, itemKey, classes, rowClass, renderHeader, renderEvidence }) {
  const scRef = useRef(null)
  const [open, setOpen] = useState(() => new Set([0]))   // latest expanded; the rest reveal on scroll
  const toggle = useCallback((i) => setOpen((prev) => {
    const next = new Set(prev)
    if (next.has(i)) next.delete(i); else next.add(i)
    return next
  }), [])
  // @@@ revealNext - open the next still-collapsed item, but only once the reader has finished the deepest
  // open item (0..frontier) — its END must be within the viewport. ONE per call, so each down gesture advances
  // exactly one. getBoundingClientRect (not offsetTop) is correct regardless of the scroller's own positioning.
  const revealNext = useCallback(() => setOpen((prev) => {
    const sc = scRef.current
    if (!sc) return prev
    let f = -1
    while (prev.has(f + 1)) f++
    if (f < 0 || f >= items.length - 1) return prev
    const el = sc.querySelector(`[data-i="${f}"]`)
    if (!el || el.getBoundingClientRect().bottom - sc.getBoundingClientRect().top > sc.clientHeight + 40) return prev
    return new Set(prev).add(f + 1)
  }), [items])
  // @@@ progressive reveal - the next item reveals on the DOWN gesture once you've read the open one. TWO
  // triggers, because a "scroll down" can't always happen: (1) the wheel/drag SCROLL event, while there's
  // overflow to move through; (2) a j/↓ KEYPRESS when the scroller can't move further — content shorter than a
  // page (no scrollbar at all) or already at the bottom. Without (2) those cases dead-ended: no scroll event
  // ever fired, so later items never expanded. They never double-fire — (2) acts only at the bottom, exactly
  // where (1), which needs movement, cannot. (Mount and scroll-up never reveal.)
  useEffect(() => {
    const sc = scRef.current
    if (!sc) return
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
  }, [revealNext])
  return (
    <div className={classes.pane} ref={scRef}>
      {items.map((it, i) => {
        const isOpen = open.has(i)
        const mod = rowClass ? rowClass(it, i) : ''
        return (
          <div data-i={i} key={itemKey(it, i)} className={`${classes.row}${mod ? ` ${mod}` : ''}${isOpen ? ' open' : ''}`}>
            <button className={classes.head} onClick={() => toggle(i)} aria-expanded={isOpen}>
              {renderHeader(it, i, isOpen)}
            </button>
            {isOpen && <figure className={classes.evidence}>{renderEvidence(it, i)}</figure>}
          </div>
        )
      })}
    </div>
  )
}

// @@@ HistoryEvidence - one version's proof, mounted only while its row is open (so older diffs fetch lazily).
// The latest renders its diff instantly from node.lastDiff (shipped on the board); older versions fetch theirs
// the first time they expand, memoised by hash so a re-open is instant (see useVersionDiff).
function HistoryEvidence({ node, r, latest }) {
  const fetched = useVersionDiff(node.id, r.hash, !latest)
  return <DiffEvidence diff={latest ? (node.lastDiff ?? fetched) : fetched} />
}

// @@@ HistoryPane - the merged version log (the old `recent` + `history` tabs, now one), a thin consumer of the
// shared ChronoPane scaffold. Each row's header is the version line (number · hash · date · the +adds/−dels it
// changed in THIS node · reason · files · session); its evidence is the spec.md line diff that version
// introduced. The latest sits open with its proof; older ones reveal on the down gesture and fetch their diff
// lazily on expand. `rows` is NodeView's one fetch, newest-first; the empty/loading states stay here so the
// scaffold only ever sees a non-empty list.
export function HistoryPane({ node, rows }) {
  const t = useT()
  if (!rows) return <div className="pane-hist empty">{t('nodeView.loadingHistory')}</div>
  if (!rows.length) return <div className="pane-hist empty">{t('common.noVersions')}</div>
  return (
    <ChronoPane
      items={rows}
      itemKey={(r) => r.hash}
      classes={{ pane: 'pane-hist', row: 'ver-row', head: 'rec-toggle', evidence: 'rec-evidence' }}
      rowClass={(r, i) => (i === 0 ? 'latest' : '')}
      renderHeader={(r, i, open) => (
        <>
          <div className="rec-head">
            <span className="rec-caret">{open ? '▾' : '▸'}</span>
            <span className="rec-v">v{rows.length - i}</span>
            <code className="rec-hash">{r.hash.slice(0, 7)}</code>
            <span className="rec-date">{(r.date || '').slice(0, 10)}</span>
            <span className="rec-diff">
              <b className="rec-add">+{r.additions ?? 0}</b>
              <b className="rec-del">−{r.deletions ?? 0}</b>
            </span>
          </div>
          <div className="rec-msg">{r.reason}</div>
          <div className="rec-sub">{t('nodeView.filesChanged', { n: r.files ?? 0 })} · {r.session || t('common.idle')}</div>
        </>
      )}
      renderEvidence={(r, i) => <HistoryEvidence node={node} r={r} latest={i === 0} />}
    />
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
export function IssuesPane({ node }) {
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
// the fork point. `enabled` keeps a closed tab from ever fetching. The edit tab unmounts on every tab toggle
// (panes are conditionally rendered), so — exactly like the history tab's per-version diffs (versionDiffCache)
// — the result is MEMOISED per (source,path): toggling back seeds the first paint from the cache instead of
// flashing the loading state. The one difference from a committed version's immutable diff is that a pending
// change is LIVE, so this REVALIDATES on each open (cache seeds the paint, a background fetch then refreshes
// it) rather than trusting the cache forever; a failed revalidate keeps the last good diff, never blanks it.
const editDiffCache = new Map()
function useEditDiff(source, path, enabled) {
  const key = `${source}\t${path}`
  const [diff, setDiff] = useState(() => editDiffCache.get(key) ?? null)
  useEffect(() => {
    if (!enabled || !source || !path) return
    const cached = editDiffCache.get(key)
    if (cached) setDiff(cached)   // show the last diff at once; the fetch below refreshes it (the change is live)
    let on = true
    fetch(`/api/edit?source=${encodeURIComponent(source)}&path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((d) => { editDiffCache.set(key, d); if (on) setDiff(d) })
      .catch(() => on && setDiff((prev) => prev ?? { patch: '' }))
    return () => { on = false }
  }, [source, path, enabled, key])
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
export function EditPane({ node }) {
  const t = useT()
  const overlays = node.overlays || []
  if (!overlays.length) return <div className="pane-edit empty">{t('nodeView.noEdit')}</div>
  return <div className="pane-edit">{overlays.map((ov, i) => <EditOverlay key={i} node={node} ov={ov} />)}</div>
}

// @@@ VerdictBadge - the loss the AGENT measured (the [[spec-yatsu]] verdict): ✓ pass (met expected, zero
// loss) / ✗ fail / ≈ note (a how-far-off text, shown on hover). A reading taken before verdicts existed has
// none → a muted `legacy` badge. This is the eval tab's headline — what the score actually SAYS.
function VerdictBadge({ verdict }) {
  const t = useT()
  if (!verdict) return <span className="eval-verdict legacy">{t('nodeView.eval.legacy')}</span>
  if (verdict.status === 'pass') return <span className="eval-verdict pass">{t('nodeView.eval.pass')}</span>
  if (verdict.status === 'fail') return <span className="eval-verdict fail">{t('nodeView.eval.fail')}</span>
  return <span className="eval-verdict note" title={verdict.note}>{t('nodeView.eval.note')}</span>
}

// @@@ TranscriptEvidence - a text transcript blob, fetched LAZILY by hash on expand (the component mounts
// only when its row is open, like the image's lazy load). Same /api/yatsu/blob/:hash endpoint the image
// uses; we read it as text and show it in a <pre>. A miss/empty fetch falls back to an empty transcript.
function TranscriptEvidence({ hash }) {
  const t = useT()
  const [text, setText] = useState(null)
  useEffect(() => {
    let live = true
    fetch(`/api/yatsu/blob/${hash}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('miss'))))
      .then((tx) => { if (live) setText(tx) })
      .catch(() => { if (live) setText('') })
    return () => { live = false }
  }, [hash])
  if (text === null) return <pre className="eval-transcript loading">{t('nodeView.eval.loadingTranscript')}</pre>
  return <pre className="eval-transcript">{text}</pre>
}

// @@@ EvalEvidence - one reading's evidence body: the scenario's `expected` (what zero loss looks like) over
// the captured proof — an image inline, a transcript as text, the *miss original file* note when the record
// outlived its bytes, else an evidence-less note (the agent attested without a capture). A `note` verdict's
// how-far-off text shows here too, so the loss is spelled out beside the proof.
function EvalEvidence({ r }) {
  const t = useT()
  return (
    <>
      {r.expected && <div className="eval-expected"><span className="eval-expected-label">{t('nodeView.eval.expected')}</span> {r.expected}</div>}
      {r.verdict?.status === 'note' && r.verdict.note && <div className="eval-note"><span className="eval-expected-label">{t('nodeView.eval.noteLabel')}</span> {r.verdict.note}</div>}
      {r.blobState === 'present'
        ? (r.blobKind === 'transcript'
            ? <TranscriptEvidence hash={r.blob} />
            : <img src={`/api/yatsu/blob/${r.blob}`} alt={t('nodeView.eval.shotAlt', { scenario: r.scenario })} loading="lazy" />)
        : <figcaption className="eval-noimg">{r.blobState === 'miss' ? t('nodeView.eval.miss') : t('nodeView.eval.noImage')}</figcaption>}
    </>
  )
}

// @@@ EvalPane - the node's measurement timeline (the [[spec-yatsu]] eval tab), a thin consumer of the SAME
// ChronoPane scaffold the history tab uses, so the scroll/reveal/toggle and the per-item header+evidence
// shape live in ONE place. The readings RIDE THE BOARD (`node.evals`, the [[yatsu-eval-tab]] fold) — the SAME
// single source as node.issues/overlays/lastDiff — so the tab is INSTANT and never shows the prior node's
// readings on a switch (the old per-node fetch never reset, so stale readings lingered and the pane loaded out
// of step with the rest). Each row's header is the score line (scenario · VERDICT ✓ pass / ✗ fail / ≈ note —
// the loss the agent measured · the SCORE circle ([[yatsu-score-badge]]): green ✓ fresh pass / red ✗ fresh fail
// / grey ✓/✗ stale (the last verdict greyed, the moved axis on hover) / empty ring no current score — the SAME
// vocabulary the node tile's card badge speaks · evaluator · codeSha · time); its evidence is the scenario's `expected` over the
// captured proof — an image inline or a transcript as text, fetched LAZILY by hash on expand, or — no capture
// — *miss original file* when the record outlived its bytes, else an evidence-less note. Two empty states stay
// distinct by presence: a node that declares no scenarios (no yatsu.md → no `evals` field at all) and one that
// declares some but hasn't been measured (an empty array). Readings arrive newest-first (the server already
// reversed the append-only sidecar). (Forge issue-events — the second evidence source — arrive with a future
// sibling node; this shows LOCAL readings only.)
export function EvalPane({ node }) {
  const t = useT()
  const readings = node.evals
  if (!readings) return <div className="pane-eval empty">{t('nodeView.eval.noScenarios')}</div>
  if (!readings.length) return <div className="pane-eval empty">{t('nodeView.eval.noReadings')}</div>
  return (
    <ChronoPane
      items={readings}
      itemKey={(r, i) => `${r.scenario}-${r.ts}-${i}`}
      classes={{ pane: 'pane-eval', row: 'eval-row', head: 'eval-head', evidence: 'eval-shot' }}
      renderHeader={(r, i, open) => (
        <>
          <span className="eval-top">
            <span className="eval-caret">{open ? '▾' : '▸'}</span>
            <span className="eval-scenario">{r.scenario}</span>
            <VerdictBadge verdict={r.verdict} />
            <ScoreBadge state={readingScore(r)} title={r.fresh ? undefined : t('nodeView.eval.staleAxes', { axes: r.staleAxes.join(', ') })} />
          </span>
          <span className="eval-meta">
            <span className="eval-evaluator">{r.evaluator}</span>
            <code className="eval-sha">{r.codeSha.slice(0, 7)}</code>
            <span className="eval-ts">{r.ts.replace('T', ' ').slice(0, 16)}</span>
          </span>
        </>
      )}
      renderEvidence={(r) => <EvalEvidence r={r} />}
    />
  )
}

// PANES keys map to localized tab labels (the key drives logic; only the label is shown).
const PANE_LABEL = { spec: 'nodeView.paneSpec', history: 'nodeView.paneHistory', issues: 'nodeView.paneIssues', eval: 'nodeView.paneEval', edit: 'nodeView.paneEdit' }

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
          {active === 'eval' && <EvalPane node={node} />}
          {active === 'edit' && <EditPane node={node} />}
        </div>
      </div>
    </div>
  )
}
