import { scenarioStates, aggregateState } from './score.jsx'
import { useT } from './i18n/index.jsx'

// @@@ focus panel - the left column: the FOCUSED node's Issues AND Scenarios in one place, with their
// satisfaction status. The proposal's core move — Issues and Scenarios are BOTH stateful bound work, so they
// share one surface and one status here instead of an issue popup that popped only on the node (privileging
// issues). It reads the focused board node verbatim (node.scenarios + node.evals + node.issues, all folded by
// /api/board), so it needs no fetch of its own and tracks focus instantly as the board polls.

// the state mark a scenario row leads with — the score vocabulary as a glyph (✓ pass · ✗ fail · ○ blind
// spot · · never measured). The colour comes from the row's state class (styles.css), so this is shape only.
const MARK = { pass: '✓', fail: '✗', stalePass: '✓', staleFail: '✗', empty: '○', missing: '·' }

function ScenarioRow({ s, t }) {
  return (
    <div className={`fp-scenario ${s.state}`}>
      <span className="fp-sc-mark" title={t(`score.${s.state}`)}>{MARK[s.state]}</span>
      <span className="fp-sc-body">
        <span className="fp-sc-name">{s.name}</span>
        {s.expected && <span className="fp-sc-expected">{s.expected}</span>}
        {s.code?.length > 0 && <span className="fp-sc-code">{t('focusPanel.tracks', { files: s.code.join(', ') })}</span>}
      </span>
    </div>
  )
}

// one issue card, reusing the shared .issue-card vocabulary (num · state · full title), linking to the forge.
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

export default function FocusPanel({ node }) {
  const t = useT()
  const states = scenarioStates(node?.scenarios, node?.evals)
  const satisfied = states.filter((s) => s.state === 'pass').length
  const issues = node?.issues || []
  const open = issues.filter((i) => (i.state || '').toLowerCase() === 'open')
  const closed = issues.filter((i) => (i.state || '').toLowerCase() !== 'open')
  return (
    <aside className="focus-panel">
      <div className="fp-head">
        <span className="fp-eyebrow">{t('focusPanel.focus')}</span>
        <span className="fp-title">{node ? node.title : t('focusPanel.noFocus')}</span>
      </div>

      <section className="fp-sec">
        <div className="fp-sec-head">
          <span>{t('focusPanel.scenarios')}</span>
          {states.length > 0 && (
            <span className={`fp-count ${aggregateState(states)}`}>✓{satisfied}/{states.length}</span>
          )}
        </div>
        {states.length
          ? states.map((s) => <ScenarioRow key={s.name} s={s} t={t} />)
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
            {open.map((i) => <IssueRow key={i.number} i={i} />)}
            {closed.length > 0 && <div className="issue-group-head closed">{t('focusPanel.closed', { n: closed.length })}</div>}
            {closed.map((i) => <IssueRow key={i.number} i={i} />)}
          </>
        ) : <div className="fp-empty">{t('focusPanel.noIssues')}</div>}
      </section>
    </aside>
  )
}
