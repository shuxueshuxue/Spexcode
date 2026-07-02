import { scenarioStates, aggregateState, TagChips } from './score.jsx'
import { useT } from './i18n/index.jsx'

// the state mark a scenario row leads with — the score vocabulary as a glyph (✓ pass · ✗ fail · ○ blind
// spot · · never measured). The colour comes from the row's state class (styles.css), so this is shape only.
const MARK = { pass: '✓', fail: '✗', stalePass: '✓', staleFail: '✗', empty: '○', missing: '·' }

// a scenario row — a BUTTON that drills into the focused node's eval tab (the deep reading timeline), so the
// glance is an entry point, not a dead end. The `expected` is a clamped preview (the full prose lives in the
// eval tab), so a long scenario never blows out the narrow column.
function ScenarioRow({ s, t, onOpenEval }) {
  return (
    <button type="button" className={`fp-scenario ${s.state}`} onClick={onOpenEval} title={t('focusPanel.openEval')}>
      <span className="fp-sc-mark" title={t(`score.${s.state}`)}>{MARK[s.state]}</span>
      <span className="fp-sc-body">
        <span className="fp-sc-name">{s.name}</span>
        <TagChips tags={s.tags} />
        {s.expected && <span className="fp-sc-expected">{s.expected}</span>}
        {s.code?.length > 0 && <span className="fp-sc-code">{t('focusPanel.tracks', { files: s.code.join(', ') })}</span>}
      </span>
    </button>
  )
}

// one issue card, reusing the shared .issue-card vocabulary (id · store · status · full concern) — the
// unified Issue shape ([[issues]]); a forge issue links out to its permalink, a local one has none.
function IssueRow({ i }) {
  const inner = (
    <>
      <span className="issue-card-top">
        <span className="issue-num">{i.id}</span>
        <span className={`fv-store fv-store-${i.store === 'local' ? 'local' : 'forge'}`}>{i.store}</span>
        <span className={`issue-state st-${i.status}`}>{i.status}</span>
      </span>
      <span className="issue-card-title">{i.concern}</span>
    </>
  )
  return i.url
    ? <a className="issue-card" href={i.url} target="_blank" rel="noreferrer">{inner}</a>
    : <span className="issue-card">{inner}</span>
}

export default function FocusPanel({ node, onOpenEval }) {
  const t = useT()
  const states = scenarioStates(node?.scenarios, node?.evals)
  const satisfied = states.filter((s) => s.state === 'pass').length
  const issues = node?.issues || []
  const open = issues.filter((i) => i.status === 'open')
  const closed = issues.filter((i) => i.status !== 'open')
  return (
    <aside className="focus-panel">
      <div className="fp-head">
        <span className="fp-title">{node ? node.title : t('focusPanel.noFocus')}</span>
        {node?.desc && <span className="fp-desc" title={node.desc}>{node.desc}</span>}
      </div>

      <section className="fp-sec">
        <div className="fp-sec-head">
          <span>{t('focusPanel.scenarios')}</span>
          {states.length > 0 && (
            <span className={`fp-count ${aggregateState(states)}`}>✓{satisfied}/{states.length}</span>
          )}
        </div>
        {states.length
          ? states.map((s) => <ScenarioRow key={s.name} s={s} t={t} onOpenEval={onOpenEval} />)
          : <div className="fp-empty">{t('focusPanel.noScenarios')}</div>}
      </section>

      <section className="fp-sec">
        <div className="fp-sec-head">
          <span>{t('focusPanel.issues')}</span>
          {issues.length > 0 && (
            <span className="fp-issue-counts">
              {open.length > 0 && <span className="issue-state st-open">{t('focusPanel.open', { n: open.length })}</span>}
              {closed.length > 0 && <span className="issue-state st-closed">{t('focusPanel.closed', { n: closed.length })}</span>}
            </span>
          )}
        </div>
        {issues.length ? (
          <>
            {open.map((i) => <IssueRow key={i.id} i={i} />)}
            {closed.length > 0 && <div className="issue-group-head closed">{t('focusPanel.closed', { n: closed.length })}</div>}
            {closed.map((i) => <IssueRow key={i.id} i={i} />)}
          </>
        ) : <div className="fp-empty">{t('focusPanel.noIssues')}</div>}
      </section>
    </aside>
  )
}
