import { scenarioStates, aggregateState, TagChips } from './score.jsx'
import { useT } from './i18n/index.jsx'
import { useSpecCorpus } from './corpus.js'
import IssueCard from './IssueCard.jsx'
import { evalAddress } from './address.js'

// the state mark a scenario row leads with — the score vocabulary as a glyph (✓ pass · ✗ fail · ○ blind
// spot · · never measured). The colour comes from the row's state class (styles.css), so this is shape only.
const MARK = { pass: '✓', fail: '✗', stalePass: '✓', staleFail: '✗', empty: '○', missing: '·' }

// a scenario row — a BUTTON that drills into the eval's routed detail address, so the glance is an entry
// point, not a dead end. The `expected` is a clamped preview (the full prose lives in the eval detail), so a
// long scenario never blows out the narrow column. The board's scenario fold is slim
// ([[graph-lean]]), so `prose` (expected + per-scenario code) joins from the lazily-fetched corpus — until it
// lands the row shows name/state/tags, then fills in.
function ScenarioRow({ nodeId, s, prose, t, onNavigateAddress }) {
  const expected = prose?.expected ?? s.expected
  const code = prose?.code ?? s.code
  return (
    <button type="button" className={`fp-scenario ${s.state}`} onClick={() => onNavigateAddress?.(evalAddress(nodeId, s.name))} data-tip={t('focusPanel.openEval')}>
      <span className="fp-sc-mark" data-tip={t(`score.${s.state}`)}>{MARK[s.state]}</span>
      <span className="fp-sc-body">
        <span className="fp-sc-name">{s.name}</span>
        <TagChips tags={s.tags} />
        {expected && <span className="fp-sc-expected">{expected}</span>}
        {code?.length > 0 && <span className="fp-sc-code">{t('focusPanel.tracks', { files: code.join(', ') })}</span>}
      </span>
    </button>
  )
}

export default function FocusPanel({ node, onNavigateAddress }) {
  const t = useT()
  const states = scenarioStates(node?.scenarios, node?.evals)
  // scenario prose for the previews — fetched once, on the FIRST focus of a node that has scenarios (the
  // panel is always mounted, so an unconditional fetch would ride every page load; see corpus.js).
  const corpus = useSpecCorpus(states.length > 0)
  const proseByName = node ? corpus?.scenarios?.[node.id] : null
  const satisfied = states.filter((s) => s.state === 'pass').length
  const issues = node?.issues || []
  const open = issues.filter((i) => i.status === 'open')
  const closed = issues.filter((i) => i.status !== 'open')
  return (
    <aside className="focus-panel">
      <div className="fp-head">
        <span className="fp-title">{node ? node.title : t('focusPanel.noFocus')}</span>
        {node?.desc && <span className="fp-desc" data-tip={node.desc}>{node.desc}</span>}
      </div>

      <section className="fp-sec">
        <div className="fp-sec-head">
          <span>{t('focusPanel.scenarios')}</span>
          {states.length > 0 && (
            <span className={`fp-count ${aggregateState(states)}`}>✓{satisfied}/{states.length}</span>
          )}
        </div>
        {states.length
          ? states.map((s) => <ScenarioRow key={s.name} nodeId={node.id} s={s} prose={proseByName?.[s.name]} t={t} onNavigateAddress={onNavigateAddress} />)
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
            {open.map((i) => <IssueCard key={i.id} issue={i} onNavigateAddress={onNavigateAddress} />)}
            {closed.length > 0 && <div className="issue-group-head closed">{t('focusPanel.closed', { n: closed.length })}</div>}
            {closed.map((i) => <IssueCard key={i.id} issue={i} onNavigateAddress={onNavigateAddress} />)}
          </>
        ) : <div className="fp-empty">{t('focusPanel.noIssues')}</div>}
      </section>
    </aside>
  )
}
