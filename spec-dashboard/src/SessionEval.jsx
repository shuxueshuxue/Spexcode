import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EvalRow, entryKey } from './EvalsFeed.jsx'
import { EvalMasterDetail } from './EvalsPage.jsx'
import EventDetail from './EventDetail.jsx'
import { ScoreBadge, scenarioStates } from './score.jsx'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'

// The session Eval tab ([[session-eval]]'s interactive face): the THIRD home of the ONE EventDetail
// component ([[event-detail]], U1) — node popup (one node) · Evals page (project) · here (this session's
// changed nodes, WORKTREE-rooted readings). The master-detail is the SAME shared shell the Evals page
// renders ([[evals-view]]'s EvalMasterDetail — split, fold, j/k), so the two surfaces cannot drift:
// collapsed rows on the left (blind spots lead, then what THIS session measured ✦-marked, then the
// inherited baseline — other sessions' latest readings — under an explicit divider; the ✦ chip narrows
// to the session's own), the shared EventDetail as the full-height detail on the right — the
// SAME media + remark thread + composer, since the (node,scenario) thread rides each reading as
// `entry.thread` (the server overlay), so there is no "no resident issues list" degradation: the composer
// authors remarks through /api/remarks. Rows are tier-1 JSON; evidence streams lazily on open — nothing is
// inlined. The self-contained proof HTML remains as the EXPORT artifact behind the ↗ button.
export default function SessionEvalPane({ sessionId, specs = [], sessions = [], onOpenSession }) {
  const t = useT()
  const [model, setModel] = useState(null)     // null loading · false none
  const [onlySession, setOnlySession] = useState(false)   // focus filter: only what THIS session measured
  const [sel, setSel] = useState(null)
  const seq = useRef(0)

  // refetch the session evals model — the source that folds each reading's trunk remark thread (entry.thread),
  // so a remark authored from the detail composer shows up here after it lands (an issue-store commit fires no board
  // SSE, so the write path pulls this explicitly). A seq guard drops a stale response from a prior session.
  const loadModel = useCallback(() => {
    const mine = ++seq.current
    return fetch(`/api/sessions/${encodeURIComponent(sessionId)}/evals`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((m) => { if (mine === seq.current) setModel(m) })
      .catch(() => { if (mine === seq.current) setModel(false) })
  }, [sessionId])

  useEffect(() => {
    setModel(null); setSel(null); setOnlySession(false)
    loadModel()
  }, [sessionId, loadModel])

  // per node: blind-spot rows lead (declared, never measured — outstanding loss), then the DECLARED
  // scenarios' current score via the ONE shared computation (scenarioStates — same as the node badge and
  // the Evals feed, so a retired scenario's residual reading never masquerades as current loss, and every
  // row carries the ✓/✗ state ScoreBadge renders). This session's own readings (✦) lead, then the
  // inherited baseline newest-first.
  const groups = useMemo(() => {
    if (!model) return []
    return model.nodes.map((n) => {
      const states = scenarioStates(n.scenarios, n.evals)
      const blind = states.filter((s) => !s.reading)
        .map((s) => ({ blind: true, scenario: s.name, expected: s.expected, tags: s.tags, node: n.id, hue: n.hue, state: 'missing' }))
      const rows = states.filter((s) => s.reading)
        .map((s) => ({ ...s.reading, expected: s.expected ?? s.reading.expected, state: s.state, node: n.id, hue: n.hue }))
        .sort((a, b) => (Number(b.inSession) - Number(a.inSession)) || (a.ts < b.ts ? 1 : -1))
      return { node: n, blind, rows, sessionN: rows.filter((r) => r.inSession).length }
    })
  }, [model])
  const sessionTotal = groups.reduce((a, g) => a + g.sessionN, 0)

  // the flat visible list drives selection (and the default: the first row — blind spot or freshest).
  const visible = useMemo(() => groups.flatMap((g) => [
    ...g.blind.map((b) => ({ kind: 'blind', key: `blind:${b.node}·${b.scenario}`, item: b })),
    ...g.rows.filter((r) => !onlySession || r.inSession).map((r) => ({ kind: 'eval', key: entryKey(r), item: r })),
  ]), [groups, onlySession])
  const effSel = sel && visible.some((v) => v.key === sel) ? sel : visible[0]?.key ?? null
  const selEntry = visible.find((v) => v.key === effSel)

  // the selected reading's WORKTREE-rooted A/B history (newest-first): the session model already carries EVERY
  // reading per node ([[session-eval]] — rooted at this branch's worktree), so hand the detail this scenario's
  // whole slice instead of letting EventDetail re-fetch the main-checkout /api/specs timeline, which lacks the
  // session's un-merged in-session reading and would strand the current video behind an old inherited one.
  // Memoized so the detail's history effect stays stable across board refreshes (re-runs only on model/selection
  // change — and a refresh after an ok/remark correctly re-sources the walk).
  const selHistory = useMemo(() => {
    if (selEntry?.kind !== 'eval') return undefined
    const n = model?.nodes.find((x) => x.id === selEntry.item.node)
    return n ? n.evals.filter((e) => e.scenario === selEntry.item.scenario) : undefined
  }, [model, selEntry])

  if (model === null) return <div className="fv-note">{t('common.loading')}</div>
  if (model === false) return <div className="fv-note">{t('sessionEval.none')}</div>

  const detail = selEntry?.kind === 'eval'
    ? <EventDetail entry={selEntry.item} history={selHistory} specs={specs} sessions={sessions} onOpenSession={onOpenSession} onWrite={loadModel} />
    : selEntry?.kind === 'blind'
      ? (
        <div className="an-detail">
          <header className="an-head">
            <span className="an-title">{selEntry.item.scenario}</span>
            <span className="an-node">{selEntry.item.node}</span>
          </header>
          {selEntry.item.expected && <div className="an-expected"><b>{t('nodeView.eval.expected')}</b> {selEntry.item.expected}</div>}
          <div className="an-hint">{t('sessionEval.blindHint')}</div>
        </div>
      )
      : <div className="fv-note">{t('sessionEval.empty')}</div>

  return (
    <div className="se-pane">
      <div className="se-gates">
        {model.gates.map((g) => (
          <span key={g.label} className={`se-gate ${g.ok ? 'ok' : 'bad'}`} data-tip={g.detail}>{g.ok ? '✓' : '✗'} {g.label}</span>
        ))}
        {sessionTotal > 0 && (
          <button className={`ef-chip ef-stale ${onlySession ? 'on' : ''}`} onClick={() => setOnlySession((v) => !v)}>
            {t('sessionEval.sessionN', { n: sessionTotal })}
          </button>
        )}
        <a className="se-export" href={`/api/sessions/${encodeURIComponent(sessionId)}/evals?format=html`} target="_blank" rel="noreferrer" data-tip={t('sessionEval.exportTitle')} aria-label={t('sessionEval.export')}>
          <Icon name="download" size={13} />
        </a>
      </div>
      <EvalMasterDetail rowKeys={visible.map((v) => v.key)} sel={effSel} onSel={setSel} detail={detail}>
        <div className="fv-scroll">
          {visible.length === 0 && <div className="fv-note">{t('sessionEval.empty')}</div>}
          {groups.map((g) => {
            const gRows = visible.filter((v) => v.item.node === g.node.id)
            if (!gRows.length && !g.node.uncoveredFrontend) return null
            return (
              <section className="fv-group" key={g.node.id}>
                <header className="fv-group-head">
                  <span className="fv-group-title" style={{ color: `hsl(${g.node.hue} 60% 60%)` }}>{g.node.title}</span>
                  {g.node.uncoveredFrontend && <span className="se-warn">{t('sessionEval.noEvalFile')}</span>}
                </header>
                {gRows.map((v, i) => {
                  // the attribution boundary: the first inherited row after the session's own ✦ rows gets a
                  // divider naming the baseline, so the two provenances can never be misread as one list.
                  const divider = v.kind === 'eval' && !v.item.inSession && i > 0 &&
                    gRows[i - 1].kind === 'eval' && gRows[i - 1].item.inSession
                  const row = v.kind === 'blind' ? (
                    <button key={v.key} className={`ef-row se-blind ${effSel === v.key ? 'sel' : ''}`} onClick={() => setSel(v.key)}>
                      <ScoreBadge state="missing" />
                      <span className="ef-scenario">{v.item.scenario}</span>
                      <span className="ef-time">{t('sessionEval.unmeasured')}</span>
                    </button>
                  ) : (
                    <EvalRow key={v.key} e={v.item} selected={effSel === v.key} onClick={() => setSel(v.key)} />
                  )
                  return divider ? [<div key={`div:${g.node.id}`} className="se-divider">{t('sessionEval.inherited')}</div>, row] : row
                })}
              </section>
            )
          })}
        </div>
      </EvalMasterDetail>
    </div>
  )
}
